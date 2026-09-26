/* ===========================================================================
   STE QUIZBALL — main.js
   Homepage logic: house theme switcher, live standings (hero), live-quiz strip
   and the little bits of chrome (nav toggle, year, clock).
   Depends on utils.js (window.STE).
   =========================================================================== */

(function () {
  'use strict';

  const {
    $, $$, ICONS, svg, setText, setHTML, store, API, toast, HOUSES, HOUSE_IDS, THEME_HOUSES, THEME_MAP,
    statusMeta, sortByScore, leadingHouse, fmtTimeOfDay, clamp, prefersReducedMotion, STORAGE,
  } = window.STE;

  /* The neutral STE emblem shown when no single house is selected. */
  const STE_LOGO = svg(
    '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>' +
      '<ellipse cx="12" cy="12" rx="10" ry="4.2"/>' +
      '<ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/>' +
      '<ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/>',
    'fill="none" stroke="currentColor" stroke-width="1.35"',
  );

  const POLL_MS = 4000;
  const reduceMotion = prefersReducedMotion();

  /* ------------------------------ Theme switcher --------------------------- */

  function applyHouse(id, persist) {
    const house = THEME_MAP[id] || THEME_MAP.ste;
    document.documentElement.dataset.house = house.id;
    if (persist !== false) store.set(STORAGE.HOUSE_STORAGE, house.id);

    $$('[data-house-btn]').forEach((btn) => {
      const active = btn.dataset.houseBtn === house.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const logo = house.id === 'ste' ? STE_LOGO : ICONS[house.id] || STE_LOGO;
    setHTML($('#brandMark'), logo);
    setHTML($('#emblemCore'), logo);

    setText($('#brandTitle'), house.id === 'ste' ? 'STE Quizball' : `${house.name}`);
    setText($('#brandSub'), house.id === 'ste' ? 'Science · Technology · Engineering' : house.domain);

    document.title =
      house.id === 'ste'
        ? 'STE Quizball — Live House Standings & Weekly Bulletin'
        : `STE Quizball · ${house.name} — ${house.domain}`;
  }

  function applyTheme(theme, persist) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    if (persist !== false) store.set(STORAGE.THEME_STORAGE, next);
    const btn = $('#themeToggle');
    if (btn) {
      setHTML(btn, ICONS[next === 'light' ? 'eye' : 'settings']);
      btn.setAttribute('title', next === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
      btn.setAttribute('aria-label', btn.getAttribute('title'));
    }
  }

  function initSwitcher() {
    const bar = $('#houseSwitcher');
    if (bar) {
      bar.innerHTML = THEME_HOUSES.map(
        (h) => `
        <button class="house-btn" type="button" data-house-btn="${h.id}" aria-pressed="false"
                style="--h:${h.color}" title="${h.name} — ${h.domain}">
          <span class="dot" aria-hidden="true"></span>
          <span class="full">${h.short}</span>
          <span class="label-sm">${h.id === 'ste' ? 'ALL' : h.name.slice(0, 2).toUpperCase()}</span>
        </button>`,
      ).join('');

      bar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-house-btn]');
        if (btn) applyHouse(btn.dataset.houseBtn);
      });
    }

    const savedHouse = store.get(STORAGE.HOUSE_STORAGE, 'ste');
    applyHouse(THEME_MAP[savedHouse] ? savedHouse : 'ste', false);
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);

    const themeBtn = $('#themeToggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      });
    }
  }

  /* ------------------------------ Count-up anim ---------------------------- */

  function countUp(el, to, duration) {
    if (!el) return;
    const from = Number(el.dataset.value || 0);
    el.dataset.value = String(to);
    if (reduceMotion || from === to) {
      setText(el, formatPoints(to));
      return;
    }
    const start = performance.now();
    const ms = duration || Math.min(900, 260 + Math.abs(to - from) * 3);
    function frame(now) {
      const t = clamp((now - start) / ms, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setText(el, formatPoints(Math.round(from + (to - from) * eased)));
      if (t < 1) requestAnimationFrame(frame);
      else setText(el, formatPoints(to));
    }
    requestAnimationFrame(frame);
  }

  const formatPoints = (n) => Number(n || 0).toLocaleString();

  /* ------------------------------ Standings -------------------------------- */

  function standingsEls() {
    const grid = $('#standingsGrid');
    if (!grid || grid.dataset.ready === '1') return grid ? $$('.stand-card', grid) : [];
    grid.innerHTML = HOUSES.map(
      (h) => `
      <article class="stand-card" data-house-card="${h.id}" style="--h:${h.color}">
        <div class="stand-top">
          <span class="stand-emblem" aria-hidden="true">${ICONS[h.id]}</span>
          <div style="min-width:0">
            <div class="stand-name-row">
              <span class="stand-name">${h.name}</span>
              <span class="crown hidden" data-crown aria-hidden="true">👑</span>
            </div>
            <div class="stand-domain">${h.domain}</div>
          </div>
          <span class="stand-rank" data-rank>–</span>
        </div>

        <div class="stand-score-row">
          <span class="stand-score" data-score data-value="0">0</span>
          <span class="stand-score-label">pts</span>
          <span class="stand-gap">
            <span class="v" data-gap>—</span>
            <span class="l">behind / lead</span>
          </span>
        </div>

        <div class="stand-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
             data-bar aria-label="${h.name} points">
          <span class="stand-fill" data-fill></span>
        </div>
        <div class="stand-meta">
          <span data-share>0% of the board</span>
          <span>${h.motto}</span>
        </div>
      </article>`,
    ).join('');
    grid.dataset.ready = '1';
    return $$('.stand-card', grid);
  }

  function renderStandings(state) {
    const cards = standingsEls();
    if (!cards.length) return;

    const scores = (state && state.scores) || {};
    const ranked = sortByScore(scores);
    const { leaders, max, tie } = leadingHouse(scores);
    const total = ranked.reduce((sum, r) => sum + Math.max(0, r.points), 0);
    const ceiling = Math.max(max, 40); // never let a tiny leader blow up the bars

    cards.forEach((card) => {
      const id = card.dataset.houseCard;
      const points = Number(scores[id]) || 0;
      const rank = ranked.findIndex((r) => r.house.id === id) + 1;
      const isLeader = !tie && leaders[0] === id;

      card.classList.toggle('is-leader', isLeader);
      countUp($('[data-score]', card), points);
      setText($('[data-rank]', card), `#${rank}`);
      $('[data-crown]', card).classList.toggle('hidden', !isLeader);

      const fill = $('[data-fill]', card);
      const pct = clamp((points / ceiling) * 100, points > 0 ? 3 : 0, 100);
      fill.style.width = `${pct}%`;
      const bar = $('[data-bar]', card);
      bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      bar.setAttribute('aria-valuetext', `${points} points`);

      const diff = max - points;
      setText($('[data-gap]', card), diff === 0 && !tie ? 'LEAD' : diff === 0 ? 'TIED' : `–${diff}`);
      setText($('[data-share]', card), total > 0 ? `${Math.round((Math.max(0, points) / total) * 100)}% of the board` : 'no points yet');
    });

    // Hero numbers
    setText($('#statTotalPoints'), formatPoints(total));
    setText($('#statQuestions'), String((state && state.questionNumber) || 0));
    setText($('#statLeader'), tie ? 'Too close' : (THEME_MAP[leaders[0]] ? THEME_MAP[leaders[0]].name : '—'));
    setText($('#statUpdated'), state && state.updatedAt ? fmtTimeOfDay(state.updatedAt) : '—');
  }

  /* ------------------------------ Live strip ------------------------------- */

  let lastStatus = null;

  function renderLiveStrip(state) {
    const pill = $('#quizStatusPill');
    const meta = statusMeta(state && state.status);
    if (pill) {
      const label = state && state.expired ? 'TIME UP' : meta.label;
      setText(pill, label);
      pill.dataset.status = state && state.expired ? 'TIME_UP' : (state && state.status) || 'IDLE';
    }
    setText($('#quizRound'), (state && state.round) || 'Round 1');
    setText(
      $('#quizQuestionLine'),
      state && state.questionNumber
        ? `Q${state.questionNumber} · ${state.category} · ${state.points} pts`
        : 'No question on the board yet',
    );

    const mini = $('#miniScores');
    if (mini) {
      mini.innerHTML = HOUSES.map(
        (h) => `
        <span class="mini-score" style="--h:${h.color}">
          <span style="width:16px;height:16px;display:inline-flex;color:${h.color}">${ICONS[h.id]}</span>
          ${h.name}
          <span class="v">${Number((state && state.scores && state.scores[h.id]) || 0).toLocaleString()}</span>
        </span>`,
      ).join('');
    }

    const livePill = $('#livePill');
    if (livePill) {
      const status = (state && state.status) || 'IDLE';
      livePill.classList.toggle('is-live', status === 'BUZZERS_OPEN');
      livePill.classList.toggle('is-warn', status === 'TIME_UP' || status === 'ANSWER_REVEALED');
      livePill.classList.remove('is-down');
      setText($('#livePillText'), status === 'BUZZERS_OPEN' ? 'Live now' : 'Quizball');
    }

    if (state && state.status !== lastStatus) {
      lastStatus = state.status;
      if (state.status === 'BUZZERS_OPEN') toast('Buzzers are open', `${state.category} · ${state.points} points on the board`, 'ok', 3000);
      else if (state.status === 'ANSWER_REVEALED') toast('Answer revealed', state.answer || 'Check the display screen', 'info', 4000);
    }
  }

  /* -------------------------------- Polling -------------------------------- */

  let failures = 0;
  let timer = null;
  let lastState = null;

  function markOffline(offline) {
    const pill = $('#livePill');
    if (!pill) return;
    pill.classList.toggle('is-down', offline);
    if (offline) {
      setText($('#livePillText'), 'Offline');
    }
  }

  async function poll() {
    try {
      const state = await API.getState({ timeout: 6000 });
      failures = 0;
      lastState = state;
      renderStandings(state);
      renderLiveStrip(state);
      markOffline(false);
      const notice = $('#dataNotice');
      if (notice) notice.classList.add('hidden');
    } catch (err) {
      failures += 1;
      if (failures >= 3) {
        markOffline(true);
        const notice = $('#dataNotice');
        if (notice) {
          notice.classList.remove('hidden');
          setText(
            $('#dataNoticeText'),
            'Live data is unavailable right now. If you are running this locally, start the app with `npm run dev` (or `npm run preview` with a KV namespace bound as QUIZ_STORE).',
          );
        }
      }
      if (failures === 3) console.warn('[ste] /api/state unreachable:', err.message);
    }
  }

  function startPolling() {
    poll();
    if (timer) clearInterval(timer);
    timer = setInterval(poll, POLL_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (timer) clearInterval(timer);
      timer = null;
    } else if (!timer) {
      startPolling();
    }
  });

  /* ------------------------------- Chrome ---------------------------------- */

  function initChrome() {
    const navToggle = $('#navToggle');
    const navLinks = $('#navLinks');
    if (navToggle && navLinks) {
      navToggle.addEventListener('click', () => {
        const open = navLinks.classList.toggle('is-open');
        navToggle.setAttribute('aria-expanded', String(open));
      });
      navLinks.addEventListener('click', (e) => {
        if (e.target.closest('a')) navLinks.classList.remove('is-open');
      });
    }

    const year = $('#footerYear');
    if (year) setText(year, String(new Date().getFullYear()));

    // Bulletin count arrives from bulletin.js via a custom event.
    document.addEventListener('ste:bulletin', (e) => {
      const detail = e.detail || {};
      setText($('#statEvents'), String(detail.count || 0));
      const hint = $('#bulletinHint');
      if (hint && detail.count) {
        setText(hint, `${detail.count} event${detail.count === 1 ? '' : 's'} on the board this cycle`);
      }
    });
  }

  /* --------------------------------- Init ---------------------------------- */

  function init() {
    initSwitcher();
    initChrome();
    standingsEls(); // paint the skeleton cards immediately
    startPolling();
    // expose a tiny handle for debugging in the console
    window.STE.page = { poll, state: () => lastState };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
