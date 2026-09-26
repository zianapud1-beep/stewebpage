/* ===========================================================================
   STE QUIZBALL — admin.js
   Officer control panel.
     Tab 1 · Mass Quizball manager : status, timers, scores, question bank (CRUD)
     Tab 2 · Weekly bulletin manager : create / edit / delete announcements
   Depends on utils.js (window.STE).
   =========================================================================== */

(function () {
  'use strict';

  const {
    $, $$, ICONS, HOUSES, HOUSE_IDS, HOUSE_MAP, setText, setHTML, store, API, toast, fmtClock,
    statusMeta, escapeHtml, admin, clamp,
  } = window.STE;

  const OFFICER_KEY = 'ste.officerName';
  const STATE_POLL_MS = 1500;
  const TICK_MS = 100;

  const els = {};
  let adminKey = admin.get();
  let state = null;
  let bank = [];
  let bankDirty = false;
  let events = [];
  let clockOffset = 0;
  let busy = false;
  let stateTimer = null;
  let tickTimer = null;
  let editingQuestionId = null;
  let editingEventId = null;
  let lastDurationMs = 30000;

  /* ================================ HELPERS =============================== */

  const officerName = () => (els.officerName && els.officerName.value.trim()) || 'officer';
  const pm = (ms) => Math.max(0, Math.round(ms / 100) / 10);

  function remainingNow() {
    if (!state) return 0;
    const t = state.timer || {};
    if (t.running && t.endsAt) return Math.max(0, t.endsAt - (Date.now() + clockOffset));
    return Math.max(0, Number(t.remainingMs) || 0);
  }

  function setBusy(next) {
    busy = next;
    if (els.app) els.app.dataset.busy = next ? '1' : '0';
  }

  function handleAuthError(err) {
    if (err && err.status === 401) {
      admin.clear();
      adminKey = '';
      lockPanel('That passcode was rejected. Please sign in again.');
      return true;
    }
    return false;
  }

  /* ================================ GATE ================================== */

  function lockPanel(message) {
    els.app.classList.add('hidden');
    els.gate.classList.remove('is-hidden');
    els.gateInput.value = '';
    if (message) {
      els.gateError.classList.remove('is-hidden');
      setText(els.gateErrorText, message);
    } else {
      els.gateError.classList.add('is-hidden');
    }
    setTimeout(() => els.gateInput.focus(), 60);
  }

  function unlockPanel() {
    els.gate.classList.add('is-hidden');
    els.app.classList.remove('hidden');
    startSync();
  }

  async function attemptUnlock(key) {
    els.gateBtn.disabled = true;
    setText(els.gateBtnLabel, 'Checking…');
    els.gateError.classList.add('is-hidden');
    try {
      await API.postState({ adminKey: key, action: 'verify' });
      admin.set(key);
      adminKey = key;
      toast('Welcome, officer', 'Control panel unlocked', 'ok');
      unlockPanel();
      refresh();
      loadEvents(true);
      return true;
    } catch (err) {
      els.gateCard.classList.remove('shake');
      void els.gateCard.offsetWidth;
      els.gateCard.classList.add('shake');
      const msg =
        err.status === 401
          ? 'Incorrect passcode. Ask the event lead for the officer code.'
          : err.status === 500
            ? err.message
            : `Could not reach the server (${err.message}).`;
      els.gateError.classList.remove('is-hidden');
      setText(els.gateErrorText, msg);
      return false;
    } finally {
      els.gateBtn.disabled = false;
      setText(els.gateBtnLabel, 'Unlock control panel');
    }
  }

  function initGate() {
    els.gateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const key = els.gateInput.value.trim();
      if (key) attemptUnlock(key);
    });
    els.gateToggle.addEventListener('click', () => {
      const isPwd = els.gateInput.type === 'password';
      els.gateInput.type = isPwd ? 'text' : 'password';
      setHTML(els.gateToggle, ICONS[isPwd ? 'lock' : 'eye']);
    });
    els.logoutBtn.addEventListener('click', () => {
      admin.clear();
      adminKey = '';
      stopSync();
      lockPanel('');
      toast('Signed out', 'The panel is locked again', 'info');
    });
    if (adminKey) {
      // A remembered passcode is verified against the server, so a stale key
      // (or one rotated via ADMIN_KEY) lands on the gate with a clear message.
      els.gateInput.value = adminKey;
      attemptUnlock(adminKey);
    } else {
      lockPanel('');
    }
  }

  /* ================================ TABS ================================== */

  function initTabs() {
    $$('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        $$('[data-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
        $$('[data-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === target));
        store.set('ste.adminTab', target);
      });
    });
    const saved = store.get('ste.adminTab', 'quizball');
    const btn = $(`[data-tab="${saved}"]`);
    if (btn) btn.click();
  }

  /* ============================ STATE SYNC ================================ */

  function applyState(next) {
    if (!next) return;
    state = next;
    if (Number.isFinite(next.serverNow)) clockOffset = next.serverNow - Date.now();
    if (Array.isArray(next.questionBank)) {
      bank = next.questionBank;
      renderBank();
    }
    if (next.timer && Number(next.timer.durationMs) > 0) lastDurationMs = next.timer.durationMs;
    renderPreview();
    renderScores();
    renderStatusButtons();
    paintTimer();
  }

  async function refresh() {
    if (busy || !adminKey) return;
    try {
      const next = await API.getState({ bank: true, timeout: 6000 });
      applyState(next);
      setText(els.connDot, 'live');
    } catch (err) {
      if (handleAuthError(err)) return;
      setText(els.connDot, 'offline');
      if (err.status === 500) toast('KV binding missing', err.message, 'bad', 8000);
    }
  }

  function startSync() {
    stopSync();
    stateTimer = setInterval(() => {
      if (!document.hidden) refresh();
    }, STATE_POLL_MS);
    tickTimer = setInterval(paintTimer, TICK_MS);
  }

  function stopSync() {
    clearInterval(stateTimer);
    clearInterval(tickTimer);
    stateTimer = null;
    tickTimer = null;
  }

  /** Send a state patch. Returns the fresh state on success, null on failure. */
  async function push(patch, opts) {
    if (busy) return null;
    if (!adminKey) {
      lockPanel('Your session expired — sign in again.');
      return null;
    }
    setBusy(true);
    try {
      const body = { adminKey, patch, updatedBy: officerName() };
      if (bankDirty || (opts && opts.bank)) {
        body.questionBank = bank;
        bankDirty = false;
      }
      const res = await API.postState(body);
      applyState(res);
      if (opts && opts.silent !== true) {
        toast(opts && opts.message ? opts.message[0] : 'Display updated', opts && opts.message ? opts.message[1] : '', 'ok', 2200);
      }
      return res;
    } catch (err) {
      if (handleAuthError(err)) return null;
      toast('Update failed', err.message, 'bad', 6000);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /* ============================== PREVIEW ================================= */

  function initPreview() {
    els.pmScores.innerHTML = HOUSES.map(
      (h) => `
      <div class="pm-score" data-pm="${h.id}" style="--h:${h.color}">
        <div class="v" data-pm-val>0</div>
        <div class="l">${h.name}</div>
      </div>`,
    ).join('');
  }

  function renderPreview() {
    if (!state) return;
    const meta = statusMeta(state.status);
    setText(els.pmStatus, meta.label);
    els.pmStatus.parentElement.dataset.status = state.status;
    setText(els.pmRound, state.round || 'Round 1');
    setText(els.pmQIndex, state.questionNumber ? `Q${state.questionNumber}` : 'No question');
    setText(els.pmQuestion, state.questionText || '—');
    setText(els.pmCategory, state.category || '—');
    setText(els.pmPoints, `${state.points || 0} pts`);
    HOUSE_IDS.forEach((id) => setText($(`[data-pm="${id}"] [data-pm-val]`), Number(state.scores[id] || 0).toLocaleString()));
  }

  /* ============================== CONTROLS ================================ */

  function renderStatusButtons() {
    if (!state) return;
    $$('[data-status-btn]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.statusBtn === state.status));
  }

  function paintTimer() {
    const remaining = remainingNow();
    const t = (state && state.timer) || {};
    const total = Math.max(1000, Number(t.durationMs) || lastDurationMs);
    setText(els.timerReadout, `${fmtClock(remaining)}`);
    setText(
      els.timerPhase,
      t.running && remaining > 0
        ? 'RUNNING'
        : remaining > 0
          ? 'PAUSED / READY'
          : state && state.status === 'IDLE'
            ? 'READY'
            : 'STOPPED',
    );
    els.timerReadout.classList.toggle('is-urgent', remaining > 0 && remaining <= 5000);
    els.timerFill.style.width = `${clamp(remaining / total, 0, 1) * 100}%`;

    if (els.pauseBtn) {
      const running = Boolean(t.running) && remaining > 0;
      setText($('.lbl', els.pauseBtn), running ? 'Pause' : 'Resume');
      setHTML($('.ico', els.pauseBtn), ICONS[running ? 'pause' : 'play']);
    }
  }

  function currentFormQuestion() {
    return {
      round: els.qRound.value.trim() || 'Round 1',
      category: els.qCategory.value.trim() || 'General STE',
      questionText: els.qText.value.trim(),
      answer: els.qAnswer.value.trim(),
      points: clamp(parseInt(els.qPoints.value, 10) || 0, 0, 1000),
      house: els.qHouse.value,
    };
  }

  function resetQuestionForm() {
    editingQuestionId = null;
    els.qForm.reset();
    els.qRound.value = (state && state.round) || 'Round 1';
    els.qCategory.value = (state && state.category) || 'General STE';
    els.qPoints.value = '10';
    els.qHouse.value = 'all';
    setText(els.qFormTitle, 'Add a question');
    setText(els.qSaveLabel, 'Save to bank');
    els.qCancel.classList.add('hidden');
    store.remove('ste.draft.question');
  }

  function fillQuestionForm(q, editId) {
    editingQuestionId = editId || q.id || null;
    els.qRound.value = q.round || 'Round 1';
    els.qCategory.value = q.category || 'General STE';
    els.qText.value = q.questionText || '';
    els.qAnswer.value = q.answer || '';
    els.qPoints.value = String(q.points || 10);
    els.qHouse.value = q.house || 'all';
    setText(els.qFormTitle, editingQuestionId ? 'Edit question' : 'Add a question');
    setText(els.qSaveLabel, editingQuestionId ? 'Update question' : 'Save to bank');
    els.qCancel.classList.remove('hidden');
    els.qText.focus();
  }

  function renderBank() {
    setText(els.bankCount, `${bank.length} saved`);
    if (!bank.length) {
      setHTML(
        els.bankList,
        `<div class="empty-state" style="padding:1.75rem 1rem">
           <div class="big">📚</div>
           <h4>Bank is empty</h4>
           <p class="text-muted">Add your first question below — it is stored in KV under <span class="mono">question_bank</span>.</p>
         </div>`,
      );
      return;
    }

    setHTML(
      els.bankList,
      bank
        .map((q, i) => {
          const house = q.house && q.house !== 'all' ? HOUSE_MAP[q.house] : null;
          const color = house ? house.color : 'var(--accent)';
          const label = house ? house.name : 'All houses';
          return `
          <div class="bank-item${editingQuestionId === q.id ? ' is-active' : ''}" data-qid="${escapeHtml(q.id)}">
            <span class="idx">${String(i + 1).padStart(2, '0')}</span>
            <div class="body">
              <div class="qt">${escapeHtml(q.questionText)}</div>
              <div class="meta">
                <span class="badge badge-sm" style="--h:${color};color:${color};border-color:${color}55">${escapeHtml(label)}</span>
                <span class="badge badge-sm">${escapeHtml(q.category)}</span>
                <span>${q.points} pts</span>
                <span>${escapeHtml(q.round)}</span>
                ${q.answer ? `<span title="Has answer">🔑 answer saved</span>` : ''}
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-xs btn-primary" data-q-push="${escapeHtml(q.id)}" title="Push to display">${ICONS.push}</button>
              <button class="btn btn-xs" data-q-edit="${escapeHtml(q.id)}" title="Edit">${ICONS.edit}</button>
              <button class="btn btn-xs btn-danger" data-q-del="${escapeHtml(q.id)}" title="Delete">${ICONS.trash}</button>
            </div>
          </div>`;
        })
        .join(''),
    );
  }

  function renderScores() {
    const scores = (state && state.scores) || {};
    HOUSE_IDS.forEach((id) => {
      const row = $(`[data-score-row="${id}"]`);
      if (!row) return;
      setText($('[data-score-val]', row), Number(scores[id] || 0).toLocaleString());
    });
  }

  function initScoreRows() {
    els.scoreList.innerHTML = HOUSES.map(
      (h) => `
      <div class="score-row" data-score-row="${h.id}" style="--h:${h.color}">
        <div class="who">
          <span style="display:inline-flex;color:${h.color};flex:0 0 auto">${ICONS[h.id]}</span>
          <div style="min-width:0">
            <div class="nm">${h.name}</div>
            <div style="font-size:.68rem;color:var(--muted-2)">${h.domain}</div>
          </div>
          <span class="val" data-score-val style="margin-left:auto">0</span>
        </div>
        <div class="score-ctl">
          <button class="btn btn-sm" data-delta="10" title="Add 10 points to ${h.name}">+10</button>
          <button class="btn btn-sm" data-delta="-10" title="Remove 10 points from ${h.name}">−10</button>
          <input class="input" type="number" inputmode="numeric" data-custom placeholder="±pts" aria-label="Custom points for ${h.name}">
          <button class="btn btn-sm btn-primary" data-apply title="Apply the custom amount">Apply</button>
        </div>
      </div>`,
    ).join('');

    els.scoreList.addEventListener('click', (e) => {
      const row = e.target.closest('[data-score-row]');
      if (!row) return;
      const id = row.dataset.scoreRow;
      const base = Number((state && state.scores && state.scores[id]) || 0);

      if (e.target.closest('[data-delta]')) {
        const delta = Number(e.target.closest('[data-delta]').dataset.delta);
        push({ scores: { [id]: base + delta } }, { message: [`${HOUSE_MAP[id].name} ${delta > 0 ? '+' : ''}${delta}`, `Now on ${base + delta} points`] });
      } else if (e.target.closest('[data-apply]')) {
        const input = $('[data-custom]', row);
        const value = parseInt(input.value, 10);
        if (!Number.isFinite(value)) {
          toast('Enter a number first', `Type the points to add or remove for ${HOUSE_MAP[id].name}`, 'warn');
          return;
        }
        push({ scores: { [id]: base + value } }, { message: [`${HOUSE_MAP[id].name} ${value > 0 ? '+' : ''}${value}`, `Now on ${base + value} points`] });
        input.value = '';
      }
    });
  }

  function initQuizballControls() {
    /* Status buttons */
    $$('[data-status-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.statusBtn;
        const patch = { status };
        if (status === 'BUZZERS_OPEN') {
          const t = (state && state.timer) || {};
          const remaining = remainingNow();
          // Opening buzzers with a dead timer would be pointless: restart it.
          if (!t.running || remaining <= 0) {
            patch.timer = { durationMs: lastDurationMs, running: true, remainingMs: lastDurationMs, endsAt: null };
          }
        } else {
          patch.timer = { running: false, endsAt: null };
          if (status === 'ANSWER_REVEALED') patch.revealAnswer = true;
          if (status === 'IDLE') patch.revealAnswer = false;
          if (status === 'TIME_UP') patch.timer.remainingMs = 0;
        }
        push(patch, { message: [statusMeta(status).label, 'Display updated'] });
      });
    });

    /* Timer presets */
    els.timerPresets.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-seconds]');
      if (btn) startTimer(Number(btn.dataset.seconds));
    });

    els.startCustom.addEventListener('click', () => {
      const seconds = clamp(parseInt(els.customSeconds.value, 10) || 0, 1, 3600);
      startTimer(seconds);
    });

    els.pauseBtn.addEventListener('click', () => {
      const remaining = remainingNow();
      const running = state && state.timer && state.timer.running && remaining > 0;
      if (running) {
        push({ timer: { running: false, remainingMs: Math.round(remaining), endsAt: null } }, { message: ['Timer paused', `${fmtClock(remaining)} left on the clock`] });
      } else {
        const ms = remaining > 0 ? remaining : lastDurationMs;
        push({ timer: { durationMs: Math.max(ms, lastDurationMs), running: true, remainingMs: Math.round(ms), endsAt: null } }, { message: ['Timer running', `${fmtClock(ms)} on the clock`] });
      }
    });

    els.resetBtn.addEventListener('click', () => {
      push(
        { status: 'IDLE', timer: { durationMs: lastDurationMs, running: false, remainingMs: lastDurationMs, endsAt: null }, revealAnswer: false },
        { message: ['Timer reset', `${fmtClock(lastDurationMs)} ready to go`] },
      );
    });

    els.revealBtn.addEventListener('click', () => {
      push({ status: 'ANSWER_REVEALED', revealAnswer: true, timer: { running: false, endsAt: null } }, { message: ['Answer revealed', state && state.answer ? state.answer : 'Shown on the display'] });
    });

    els.resetScores.addEventListener('click', () => {
      if (!window.confirm('Reset all four house scores to 0? This cannot be undone.')) return;
      push({ scores: { zeus: 0, poseidon: 0, athena: 0, aphrodite: 0 } }, { message: ['Scores cleared', 'All houses are back to 0'] });
    });

    /* Question bank ------------------------------------------------------- */
    els.qForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const draft = currentFormQuestion();
      if (!draft.questionText) {
        toast('Question text required', 'Type the question before saving.', 'warn');
        els.qText.focus();
        return;
      }
      if (editingQuestionId) {
        bank = bank.map((q) => (q.id === editingQuestionId ? { ...q, ...draft } : q));
        toast('Question updated', `${bank.length} questions in the bank`, 'ok');
      } else {
        const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        bank = [...bank, { id, ...draft }];
        toast('Question added', 'Saved to the bank', 'ok');
      }
      bankDirty = true;
      renderBank();
      resetQuestionForm();
      push({}, { bank: true, silent: true });
    });

    els.qCancel.addEventListener('click', resetQuestionForm);

    els.qText.addEventListener('input', () => {
      store.set('ste.draft.question', els.qText.value);
    });
    els.qAnswer.addEventListener('input', () => {
      store.set('ste.draft.answer', els.qAnswer.value);
    });

    els.bankList.addEventListener('click', (e) => {
      const pushBtn = e.target.closest('[data-q-push]');
      const editBtn = e.target.closest('[data-q-edit]');
      const delBtn = e.target.closest('[data-q-del]');

      if (pushBtn) {
        const q = bank.find((x) => x.id === pushBtn.dataset.qPush);
        if (q) pushQuestionToDisplay(q);
      } else if (editBtn) {
        const q = bank.find((x) => x.id === editBtn.dataset.qEdit);
        if (q) fillQuestionForm(q, q.id);
      } else if (delBtn) {
        const q = bank.find((x) => x.id === delBtn.dataset.qDel);
        if (q && window.confirm(`Delete this question?\n\n"${q.questionText.slice(0, 90)}"`)) {
          bank = bank.filter((x) => x.id !== q.id);
          bankDirty = true;
          if (editingQuestionId === q.id) resetQuestionForm();
          renderBank();
          push({}, { bank: true, silent: true, message: ['Question deleted', ''] });
        }
      }
    });

    els.bankExport.addEventListener('click', () => downloadJSON('ste-question-bank.json', bank));
    els.bankImport.addEventListener('change', (e) => importJSON(e, (data) => {
      if (!Array.isArray(data)) throw new Error('Expected a JSON array of questions');
      bank = data;
      bankDirty = true;
      renderBank();
      push({}, { bank: true, message: [`Imported ${bank.length} questions`, 'Bank replaced'] });
    }));
    els.bankClear.addEventListener('click', () => {
      if (!bank.length || !window.confirm('Delete every question from the bank?')) return;
      bank = [];
      bankDirty = true;
      resetQuestionForm();
      renderBank();
      push({}, { bank: true, message: ['Bank cleared', ''] });
    });

    /* push current form straight to the display --------------------------- */
    els.pushForm.addEventListener('click', () => {
      const draft = currentFormQuestion();
      if (!draft.questionText) {
        toast('Nothing to push', 'Type a question first.', 'warn');
        return;
      }
      pushQuestionToDisplay(draft, true);
    });
  }

  function startTimer(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const ms = seconds * 1000;
    lastDurationMs = ms;
    push(
      { status: 'BUZZERS_OPEN', revealAnswer: false, timer: { durationMs: ms, running: true, remainingMs: ms, endsAt: null } },
      { message: [`${seconds}s timer started`, 'Buzzers are open'] },
    );
  }

  async function pushQuestionToDisplay(q, fromForm) {
    const nextNumber = ((state && state.questionNumber) || 0) + 1;
    const open = els.openOnPush.checked;
    const patch = {
      round: q.round || 'Round 1',
      category: q.category || 'General STE',
      questionText: q.questionText,
      answer: q.answer || '',
      points: Number(q.points) || 0,
      questionNumber: nextNumber,
      revealAnswer: false,
      status: open ? 'BUZZERS_OPEN' : 'IDLE',
    };
    if (open) {
      patch.timer = { durationMs: lastDurationMs, running: true, remainingMs: lastDurationMs, endsAt: null };
    } else {
      patch.timer = { durationMs: lastDurationMs, running: false, remainingMs: lastDurationMs, endsAt: null };
    }

    const res = await push(patch, {
      bank: fromForm ? true : bankDirty,
      message: [`Question ${nextNumber} on the board`, open ? 'Buzzers open' : 'Ready when you are'],
    });
    if (res && fromForm) {
      // Saving a form-pushed question into the bank keeps the archive complete.
      const exists = bank.some((x) => x.questionText === q.questionText && x.category === q.category);
      if (!exists) {
        bank = [...bank, { id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, ...q }];
        bankDirty = true;
        renderBank();
        push({}, { bank: true, silent: true });
      }
      resetQuestionForm();
    } else if (res) {
      renderBank();
    }
  }

  /* ============================= BULLETIN ================================= */

  function resetEventForm() {
    editingEventId = null;
    els.evForm.reset();
    setText(els.evFormTitle, 'Post a new event');
    setText(els.evSaveLabel, 'Publish event');
    els.evCancel.classList.add('hidden');
    els.evWeek.value = els.evWeek.dataset.suggested || els.evWeek.value || '1';
    els.evPoints.value = '10';
    store.remove('ste.draft.event');
  }

  function fillEventForm(ev) {
    editingEventId = ev.id;
    els.evTitle.value = ev.title || '';
    els.evWeek.value = String(ev.week || 1);
    els.evHouse.value = ev.house || 'all';
    els.evCategory.value = ev.category || '';
    els.evDatetime.value = ev.datetime || '';
    els.evLocation.value = ev.location || '';
    els.evPoints.value = String(ev.points || 0);
    els.evDescription.value = ev.description || '';
    els.evPinned.checked = Boolean(ev.pinned);
    setText(els.evFormTitle, 'Edit event');
    setText(els.evSaveLabel, 'Save changes');
    els.evCancel.classList.remove('hidden');
    els.evForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    els.evTitle.focus();
  }

  function renderEvents() {
    setText(els.evCount, `${events.length} event${events.length === 1 ? '' : 's'}`);
    if (!events.length) {
      setHTML(
        els.eventList,
        `<div class="empty-state" style="padding:1.75rem 1rem">
           <div class="big">🗓️</div>
           <h4>No events posted</h4>
           <p class="text-muted">Publish the first announcement with the form — it appears instantly on the homepage.</p>
         </div>`,
      );
      return;
    }

    setHTML(
      els.eventList,
      events
        .map((ev) => {
          const house = ev.house !== 'all' ? HOUSE_MAP[ev.house] : null;
          const color = house ? house.color : 'var(--accent)';
          const label = house ? house.name : 'Whole School';
          return `
          <div class="ba-item" data-evid="${escapeHtml(ev.id)}" style="--h:${color}">
            <div style="min-width:0">
              <div class="ttl">${ev.pinned ? '📌 ' : ''}${escapeHtml(ev.title)}</div>
              <div class="meta">
                <span class="badge badge-sm" style="color:${color};border-color:${color}55">${escapeHtml(label)}</span>
                <span>Week ${ev.week}</span>
                <span>${escapeHtml(ev.category || 'General')}</span>
                <span>${window.STE.fmtDateTime(ev.datetime)}</span>
                <span>${Number(ev.points) || 0} pts</span>
              </div>
            </div>
            <div class="actions">
              <button class="btn btn-xs ${ev.pinned ? 'btn-warn' : ''}" data-ev-pin title="Pin / unpin">📌</button>
              <button class="btn btn-xs" data-ev-edit title="Edit">${ICONS.edit}</button>
              <button class="btn btn-xs btn-danger" data-ev-del title="Delete">${ICONS.trash}</button>
            </div>
          </div>`;
        })
        .join(''),
    );
  }

  async function loadEvents(silent) {
    try {
      const data = await API.getBulletin();
      events = Array.isArray(data) ? data : [];
      renderEvents();
      if (events.length && !els.evWeek.dataset.suggested) {
        const maxWeek = Math.max(...events.map((e) => Number(e.week) || 1));
        els.evWeek.dataset.suggested = String(maxWeek);
        if (!els.evWeek.value) els.evWeek.value = String(maxWeek);
      }
    } catch (err) {
      if (!silent) toast('Could not load events', err.message, 'bad');
      setHTML(
        els.eventList,
        `<div class="empty-state" style="padding:1.5rem 1rem">
           <div class="big">⚠️</div><h4>Bulletin unavailable</h4>
           <p class="text-muted">${escapeHtml(err.message)}</p>
         </div>`,
      );
    }
  }

  async function postBulletin(body, okTitle, okBody) {
    if (busy) return null;
    setBusy(true);
    try {
      const res = await API.postBulletin({ adminKey, ...body });
      events = (res && res.events) || events;
      renderEvents();
      if (okTitle) toast(okTitle, okBody || '', 'ok');
      return res;
    } catch (err) {
      if (!handleAuthError(err)) toast('Bulletin update failed', err.message, 'bad', 6000);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function initBulletinControls() {
    els.evForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const event = {
        id: editingEventId || undefined,
        title: els.evTitle.value.trim(),
        week: parseInt(els.evWeek.value, 10) || 0,
        house: els.evHouse.value,
        category: els.evCategory.value.trim() || 'General',
        datetime: els.evDatetime.value,
        location: els.evLocation.value.trim(),
        points: parseInt(els.evPoints.value, 10) || 0,
        description: els.evDescription.value.trim(),
        pinned: els.evPinned.checked,
      };
      if (!event.title) {
        toast('Title required', 'Give the announcement a title.', 'warn');
        els.evTitle.focus();
        return;
      }
      postBulletin({ event }, editingEventId ? 'Event updated' : 'Event published', event.title);
      resetEventForm();
    });

    els.evCancel.addEventListener('click', resetEventForm);

    els.evTitle.addEventListener('input', () => store.set('ste.draft.event', els.evTitle.value));
    els.evDescription.addEventListener('input', () => store.set('ste.draft.eventBody', els.evDescription.value));

    els.eventList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-evid]');
      if (!item) return;
      const ev = events.find((x) => x.id === item.dataset.evid);
      if (!ev) return;

      if (e.target.closest('[data-ev-edit]')) {
        fillEventForm(ev);
      } else if (e.target.closest('[data-ev-del]')) {
        if (window.confirm(`Delete "${ev.title}"?`)) postBulletin({ deleteId: ev.id }, 'Event deleted', ev.title);
      } else if (e.target.closest('[data-ev-pin]')) {
        postBulletin({ event: { ...ev, pinned: !ev.pinned } }, ev.pinned ? 'Unpinned' : 'Pinned to the top', ev.title);
      }
    });

    els.evRefresh.addEventListener('click', () => loadEvents(false));
    els.evExport.addEventListener('click', () => downloadJSON('ste-weekly-bulletin.json', events));
    els.evImport.addEventListener('change', (e) =>
      importJSON(e, (data) => {
        if (!Array.isArray(data)) throw new Error('Expected a JSON array of events');
        return postBulletin({ events: data }, `Imported ${data.length} events`, 'Bulletin replaced');
      }),
    );
  }

  /* =========================== FILE HELPERS =============================== */

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported', filename, 'ok');
  }

  function importJSON(event, handler) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        handler(JSON.parse(String(reader.result)));
      } catch (err) {
        toast('Import failed', err.message, 'bad', 6000);
      }
    };
    reader.readAsText(file);
  }

  /* ============================ SHORTCUTS ================================= */

  function initShortcuts() {
    document.addEventListener('keydown', (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const map = {
        b: () => push({ status: 'BUZZERS_OPEN' }, { message: ['BUZZERS OPEN', 'Shortcut B'] }),
        t: () => push({ status: 'TIME_UP', timer: { running: false, remainingMs: 0, endsAt: null } }, { message: ['TIME UP', 'Shortcut T'] }),
        a: () => push({ status: 'ANSWER_REVEALED', revealAnswer: true, timer: { running: false, endsAt: null } }, { message: ['ANSWER REVEALED', 'Shortcut A'] }),
        r: () => push({ status: 'IDLE', timer: { durationMs: lastDurationMs, running: false, remainingMs: lastDurationMs, endsAt: null } }, { message: ['Reset', 'Shortcut R'] }),
        1: () => startTimer(10),
        2: () => startTimer(30),
        3: () => startTimer(60),
      };
      const fn = map[e.key.toLowerCase()];
      if (fn && !els.app.classList.contains('hidden')) {
        e.preventDefault();
        fn();
      }
    });
  }

  /* ================================ INIT ================================== */

  function init() {
    els.app = $('#adminApp');
    els.gate = $('#gate');
    els.gateCard = $('#gateCard');
    els.gateForm = $('#gateForm');
    els.gateInput = $('#gateInput');
    els.gateBtn = $('#gateBtn');
    els.gateBtnLabel = $('#gateBtnLabel');
    els.gateToggle = $('#gateToggle');
    els.gateError = $('#gateError');
    els.gateErrorText = $('#gateErrorText');
    els.logoutBtn = $('#logoutBtn');
    els.officerName = $('#officerName');
    els.connDot = $('#connDot');

    els.pmScores = $('#pmScores');
    els.pmStatus = $('#pmStatus');
    els.pmRound = $('#pmRound');
    els.pmQIndex = $('#pmQIndex');
    els.pmQuestion = $('#pmQuestion');
    els.pmCategory = $('#pmCategory');
    els.pmPoints = $('#pmPoints');

    els.timerPresets = $('#timerPresets');
    els.customSeconds = $('#customSeconds');
    els.startCustom = $('#startCustom');
    els.pauseBtn = $('#pauseBtn');
    els.resetBtn = $('#resetBtn');
    els.revealBtn = $('#revealBtn');
    els.timerReadout = $('#timerReadout');
    els.timerPhase = $('#timerPhase');
    els.timerFill = $('#timerFill');

    els.scoreList = $('#scoreList');
    els.resetScores = $('#resetScores');

    els.qForm = $('#qForm');
    els.qFormTitle = $('#qFormTitle');
    els.qRound = $('#qRound');
    els.qCategory = $('#qCategory');
    els.qText = $('#qText');
    els.qAnswer = $('#qAnswer');
    els.qPoints = $('#qPoints');
    els.qHouse = $('#qHouse');
    els.qSaveLabel = $('#qSaveLabel');
    els.qCancel = $('#qCancel');
    els.pushForm = $('#pushForm');
    els.openOnPush = $('#openOnPush');
    els.bankList = $('#bankList');
    els.bankCount = $('#bankCount');
    els.bankExport = $('#bankExport');
    els.bankImport = $('#bankImport');
    els.bankClear = $('#bankClear');

    els.evForm = $('#evForm');
    els.evFormTitle = $('#evFormTitle');
    els.evTitle = $('#evTitle');
    els.evWeek = $('#evWeek');
    els.evHouse = $('#evHouse');
    els.evCategory = $('#evCategory');
    els.evDatetime = $('#evDatetime');
    els.evLocation = $('#evLocation');
    els.evPoints = $('#evPoints');
    els.evDescription = $('#evDescription');
    els.evPinned = $('#evPinned');
    els.evSaveLabel = $('#evSaveLabel');
    els.evCancel = $('#evCancel');
    els.eventList = $('#eventList');
    els.evCount = $('#evCount');
    els.evRefresh = $('#evRefresh');
    els.evExport = $('#evExport');
    els.evImport = $('#evImport');

    // restore the officer name + drafts
    els.officerName.value = store.get(OFFICER_KEY, '');
    els.officerName.addEventListener('change', () => store.set(OFFICER_KEY, els.officerName.value.trim()));

    initTabs();
    initPreview();
    initScoreRows();
    initQuizballControls();
    initBulletinControls();
    initShortcuts();
    initGate();

    els.qPoints.value = '10';
    els.evPoints.value = '10';
    // restore the most recent draft text so a refresh never loses typing
    const qDraft = store.get('ste.draft.question', '');
    if (qDraft) els.qText.value = qDraft;
    const eDraft = store.get('ste.draft.event', '');
    if (eDraft) els.evTitle.value = eDraft;

    // show a helpful nudge if the panel is opened before it can reach the API
    window.addEventListener('online', () => refresh());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
