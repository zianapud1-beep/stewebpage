/* ===========================================================================
   STE QUIZBALL — display.js
   Projector sync engine.
     • short-polls GET /api/state every 500 ms (spec: 500ms)
     • anchors the countdown to the server clock (serverNow + RTT/2)
     • runs the timer locally with requestAnimationFrame so the digits never
       stutter between polls
     • derives TIME UP locally the moment the deadline passes
   Depends on utils.js (window.STE).
   =========================================================================== */

(function () {
  'use strict';

  const {
    $, ICONS, HOUSES, HOUSE_IDS, HOUSE_MAP, setText, store, API, statusMeta, clamp, fmtClock, leadingHouse,
    prefersReducedMotion, STORAGE,
  } = window.STE;

  const POLL_MS = 500;            // spec: short-poll every 500ms
  const STALE_MS = 2500;          // no successful poll in this long → amber
  const DOWN_MS = 8000;           // …and this long → red
  const URGENT_MS = 5000;         // digits turn red under this
  const RING_CIRCUMFERENCE = 2 * Math.PI * 54;

  const els = {};
  const tiles = {};
  const lastScores = { zeus: 0, poseidon: 0, athena: 0, aphrodite: 0 };
  const reduceMotion = prefersReducedMotion();

  let state = null;               // last known good state from the server
  let clockOffset = 0;            // serverNow - clientNow
  let lastSuccessAt = 0;
  let lastVersion = -1;
  let pollTimer = null;
  let rafId = null;
  let lastPaint = 0;
  let standbyDismissed = false;
  let lastRenderedStatus = null;

  /* --------------------------------- Theme --------------------------------- */

  function initTheme() {
    const params = new URLSearchParams(location.search);
    const requested = params.get('theme') || store.get(STORAGE.HOUSE_STORAGE, 'ste');
    const house = HOUSE_MAP[requested] ? requested : 'ste';
    document.documentElement.dataset.house = house;
    store.set(STORAGE.HOUSE_STORAGE, house);
  }

  /* ------------------------------- Scoreboard ------------------------------- */

  function buildScoreboard() {
    els.scoreboard.innerHTML = HOUSES.map(
      (h) => `
      <div class="score-tile" data-tile="${h.id}" style="--h:${h.color}">
        <div class="st-head">
          <span class="st-emblem" aria-hidden="true">${ICONS[h.id]}</span>
          <span class="st-name">${h.name}</span>
          <span class="st-crown" data-crown hidden aria-hidden="true">👑</span>
        </div>
        <div class="st-score" data-score data-value="0">0</div>
        <div class="st-score-label">points</div>
      </div>`,
    ).join('');

    HOUSES.forEach((h) => {
      tiles[h.id] = {
        root: $(`[data-tile="${h.id}"]`, els.scoreboard),
        score: $(`[data-tile="${h.id}"] [data-score]`, els.scoreboard),
        crown: $(`[data-tile="${h.id}"] [data-crown]`, els.scoreboard),
      };
    });
  }

  function flashDelta(tile, diff) {
    if (reduceMotion || !tile || !diff) return;
    const old = $('.st-delta', tile);
    if (old) old.remove();
    const el = document.createElement('span');
    el.className = `st-delta${diff < 0 ? ' is-neg' : ''}`;
    el.textContent = `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`;
    tile.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function renderScores(scores) {
    const safe = scores || {};
    const { leaders, tie } = leadingHouse(safe);

    HOUSE_IDS.forEach((id) => {
      const t = tiles[id];
      if (!t) return;
      const next = Number(safe[id]) || 0;
      const diff = next - (lastScores[id] || 0);

      if (t.score.textContent !== String(next)) {
        setText(t.score, next.toLocaleString());
        t.score.dataset.value = String(next);
      }

      if (diff !== 0 && lastRenderedStatus !== null) {
        flashDelta(t.root, diff);
        t.root.classList.remove('is-up');
        void t.root.offsetWidth; // restart the animation
        t.root.classList.add('is-up');
      }

      const isLeader = !tie && leaders[0] === id;
      t.root.classList.toggle('is-leading', isLeader);
      t.crown.hidden = !isLeader;
      lastScores[id] = next;
    });
  }

  /* -------------------------------- Question -------------------------------- */

  function renderQuestion(s) {
    setText(els.round, s.round || 'Round 1');
    setText(els.qIndex, s.questionNumber ? `QUESTION ${s.questionNumber}` : 'WARM-UP');
    setText(els.qCategory, s.category || 'General STE');

    const text = s.questionText || 'Waiting for the next question…';
    setText(els.qText, text);
    els.qText.classList.toggle('is-long', text.length > 90);

    setText(els.qPoints, Number(s.points) || 0);

    const showAnswer = Boolean(s.revealAnswer) && Boolean(s.answer);
    els.answer.classList.toggle('is-hidden', !showAnswer);
    if (showAnswer) setText(els.answerValue, s.answer);
  }

  function renderStatus(effective) {
    const meta = statusMeta(effective);
    els.statusChip.dataset.status = effective;
    setText(els.statusText, meta.label);
    els.statusChip.setAttribute('aria-label', `Status: ${meta.label}`);

    if (effective !== lastRenderedStatus) {
      document.title =
        effective === 'BUZZERS_OPEN'
          ? '🔔 BUZZERS OPEN · STE Quizball'
          : effective === 'TIME_UP'
            ? '⏱ TIME UP · STE Quizball'
            : effective === 'ANSWER_REVEALED'
              ? '✅ ANSWER REVEALED · STE Quizball'
              : 'STE Quizball — Live Display';
      lastRenderedStatus = effective;
    }
  }

  /* --------------------------------- Timer ---------------------------------- */

  /** Remaining milliseconds right now, derived from the server-anchored clock. */
  function currentRemaining(s) {
    if (!s) return 0;
    const t = s.timer || {};
    if (t.running && t.endsAt) return Math.max(0, t.endsAt - (Date.now() + clockOffset));
    return Math.max(0, Number(t.remainingMs) || 0);
  }

  function paintTimer(remaining, s) {
    const t = (s && s.timer) || {};
    const duration = Math.max(1000, Number(t.durationMs) || 30000);
    const fraction = clamp(remaining / duration, 0, 1);
    const urgent = remaining > 0 && remaining <= URGENT_MS;
    const running = Boolean(t.running) && remaining > 0;

    els.timerWrap.classList.toggle('is-urgent', urgent);
    els.timerWrap.classList.toggle('is-paused', !running && remaining > 0);

    setText(els.timerDigits, fmtClock(remaining));

    if (els.ringProg) {
      els.ringProg.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
      els.ringProg.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - fraction)}`;
    }
    if (els.timerBar) els.timerBar.style.width = `${fraction * 100}%`;

    const status = (s && s.status) || 'IDLE';
    if (running) setText(els.timerLabel, `Buzzers open · ${Math.ceil(remaining / 1000)}s remaining`);
    else if (remaining > 0 && status === 'IDLE') setText(els.timerLabel, `Ready · ${fmtClock(remaining)} on the clock`);
    else if (remaining > 0) setText(els.timerLabel, `Paused at ${fmtClock(remaining)}`);
    else setText(els.timerLabel, 'Time up — no more buzzes');
  }

  function timerLoop() {
    rafId = requestAnimationFrame(timerLoop);
    const now = performance.now();
    if (now - lastPaint < 50) return; // 20fps is plenty for a tenths countdown
    lastPaint = now;
    if (!state) return;

    const remaining = currentRemaining(state);
    paintTimer(remaining, state);
    const effective = deriveStatus(state, remaining);
    if (effective !== els.statusChip.dataset.status) renderStatus(effective);
  }

  /** Local derivation so the board reacts instantly, without waiting on a poll. */
  function deriveStatus(s, remaining) {
    if (!s) return 'IDLE';
    const t = s.timer || {};
    if (s.status === 'BUZZERS_OPEN' && (s.expired || (t.running && remaining <= 0))) return 'TIME_UP';
    return s.status || 'IDLE';
  }

  /* --------------------------------- Standby -------------------------------- */

  function renderStandby(s, effective) {
    const show = !standbyDismissed && effective === 'IDLE' && !(s && s.questionNumber);
    els.standby.classList.toggle('is-hidden', !show);
    if (show) {
      setText(els.standbyNote, s && s.questionText ? s.questionText : 'The next question will appear here automatically.');
    }
  }

  /* --------------------------------- Sync UI -------------------------------- */

  function paintSync(ok) {
    const age = Date.now() - lastSuccessAt;
    const stale = !ok || age > STALE_MS;
    const down = !ok || age > DOWN_MS;
    els.sync.classList.toggle('is-stale', stale && !down);
    els.sync.classList.toggle('is-down', down);
    setText(
      els.syncText,
      down ? (lastSuccessAt ? 'reconnecting…' : 'connecting…') : `synced · ${els.latency}ms`,
    );
  }

  /* --------------------------------- Polling -------------------------------- */

  let failures = 0;
  let inflight = false;

  async function poll() {
    if (inflight) return;
    inflight = true;
    const t0 = performance.now();
    try {
      const data = await API.getState({ timeout: 4000 });
      const rtt = performance.now() - t0;
      els.latency = Math.round(rtt);
      lastSuccessAt = Date.now();
      failures = 0;
      if (Number.isFinite(data.serverNow)) clockOffset = data.serverNow + rtt / 2 - Date.now();

      state = data;
      const changed = data.version !== lastVersion;
      lastVersion = data.version;

      renderScores(data.scores);
      renderQuestion(data);
      const remaining = currentRemaining(data);
      const effective = deriveStatus(data, remaining);
      renderStatus(effective);
      paintTimer(remaining, data);
      renderStandby(data, effective);
      paintSync(true);

      els.footUpdated.textContent = `state v${data.version} · updated ${new Date(data.updatedAt).toLocaleTimeString()}`;
      if (changed && data.updatedBy) els.footBy.textContent = `by ${data.updatedBy}`;
    } catch (err) {
      failures += 1;
      paintSync(false);
      if (failures === 5) console.warn('[ste] display losing sync:', err.message);
    } finally {
      inflight = false;
      schedule();
    }
  }

  function schedule() {
    clearTimeout(pollTimer);
    // Never overlap requests; a slow response simply delays the next tick.
    pollTimer = setTimeout(poll, POLL_MS);
  }

  /* ------------------------------- Objectives ------------------------------- */

  function initChrome() {
    // Fullscreen toggle (projector friendly) — click the screen or press F.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      }
      if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('chrome-hidden');
    });

    els.standby.addEventListener('click', () => {
      standbyDismissed = true;
      els.standby.classList.add('is-hidden');
    });

    // Clock in the footer
    setInterval(() => setText(els.clock, new Date().toLocaleTimeString()), 1000);

    // React instantly when the tab becomes visible again after being hidden.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) poll();
    });
  }

  /* ----------------------------------- Init --------------------------------- */

  function init() {
    els.scoreboard = $('#scoreboard');
    els.round = $('#roundLabel');
    els.qIndex = $('#qIndex');
    els.qCategory = $('#qCategory');
    els.qText = $('#qText');
    els.qPoints = $('#qValue');
    els.answer = $('#answerPanel');
    els.answerValue = $('#answerValue');
    els.statusChip = $('#statusChip');
    els.statusText = $('#statusText');
    els.timerWrap = $('#timerWrap');
    els.timerDigits = $('#timerDigits');
    els.ringProg = $('#ringProg');
    els.timerBar = $('#timerBarFill');
    els.timerLabel = $('#timerLabel');
    els.sync = $('#syncBadge');
    els.syncText = $('#syncText');
    els.latency = 0;
    els.clock = $('#displayClock');
    els.footUpdated = $('#footUpdated');
    els.footBy = $('#footBy');
    els.standby = $('#standby');
    els.standbyNote = $('#standbyNote');

    initTheme();
    buildScoreboard();
    if (els.ringProg) els.ringProg.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
    lastRenderedStatus = null;

    initChrome();
    if (!reduceMotion && rafId === null) rafId = requestAnimationFrame(timerLoop);
    poll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
