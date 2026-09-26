/* ===========================================================================
   STE QUIZBALL — bulletin.js
   Weekly bulletin board: loads /api/bulletin, renders announcement cards and
   filters them by target house (ALL / ZEUS / POSEIDON / ATHENA / APHRODITE).
   Depends on utils.js (window.STE).
   =========================================================================== */

(function () {
  'use strict';

  const {
    $, $$, ICONS, houseIcon, houseOrAll, escapeHtml, fmtDateTime, relativeDay, API, toast, FILTERS, HOUSE_MAP,
    setText, setHTML,
  } = window.STE;

  const REFRESH_MS = 60000;

  let events = [];
  let activeFilter = 'all';
  let searchTerm = '';
  let upcomingOnly = false;
  let loading = false;

  const els = {};

  /* ------------------------------- Rendering ------------------------------- */

  function filterCounts() {
    const now = Date.now();
    return FILTERS.reduce((acc, f) => {
      acc[f.id] = events.filter((ev) => {
        const houseOk = f.id === 'all' || ev.house === f.id;
        const timeOk = !upcomingOnly || !ev.datetime || new Date(ev.datetime).getTime() >= now - 43200000;
        return houseOk && timeOk;
      }).length;
      return acc;
    }, {});
  }

  function visibleEvents() {
    const now = Date.now();
    const q = searchTerm.trim().toLowerCase();
    return events.filter((ev) => {
      if (activeFilter !== 'all' && ev.house !== activeFilter) return false;
      if (upcomingOnly && ev.datetime && new Date(ev.datetime).getTime() < now - 43200000) return false;
      if (!q) return true;
      return `${ev.title} ${ev.description} ${ev.category} ${ev.location} week ${ev.week}`.toLowerCase().includes(q);
    });
  }

  function renderFilters() {
    const bar = els.filters;
    if (!bar) return;
    const counts = filterCounts();
    bar.innerHTML = FILTERS.map((f) => {
      const house = houseOrAll(f.id === 'all' ? 'ste' : f.id);
      const color = f.id === 'all' ? null : house.color;
      return `
        <button class="filter-btn" type="button" data-filter="${f.id}"
                style="${color ? `--h:${color}` : ''}" aria-pressed="${activeFilter === f.id}">
          ${f.id === 'all' ? 'ALL' : house.name.toUpperCase()}
          <span class="count">${counts[f.id] || 0}</span>
        </button>`;
    }).join('');

    $$('[data-filter]', bar).forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.filter === activeFilter);
    });
  }

  function eventCard(ev, index) {
    const house = ev.house === 'all' ? null : HOUSE_MAP[ev.house];
    const color = house ? house.color : 'var(--accent)';
    const label = house ? house.name : 'Whole School';
    const pts = Number(ev.points) || 0;
    const icon = house ? ICONS[house.id] : ICONS.spark;
    const when = fmtDateTime(ev.datetime);
    const rel = relativeDay(ev.datetime);

    return `
      <article class="event-card${ev.pinned ? ' is-pinned' : ''}" style="--h:${color}; animation-delay:${Math.min(index * 45, 400)}ms">
        <div class="event-head">
          <span class="week-tag">${ICONS.calendar.replace('<svg', '<svg style="width:12px;height:12px"')}WEEK ${ev.week}</span>
          ${ev.pinned ? '<span class="badge badge-warn">📌 PINNED</span>' : ''}
          <span class="badge badge-accent">${escapeHtml(ev.category || 'General')}</span>
          <span class="spacer"></span>
          <span class="house-chip" style="--h:${color}">
            <span class="dot"></span>${escapeHtml(label)}
          </span>
        </div>

        <h3 class="event-title">${escapeHtml(ev.title)}</h3>
        ${ev.description ? `<p class="event-desc">${escapeHtml(ev.description)}</p>` : ''}

        <div class="event-meta">
          <span class="meta-item">${ICONS.clock}${escapeHtml(when)}</span>
          ${ev.location ? `<span class="meta-item">${ICONS.pin}${escapeHtml(ev.location)}</span>` : ''}
          <span class="meta-item points">${ICONS.trophy}${pts > 0 ? `+${pts} pts available` : 'No points'}</span>
        </div>

        <div class="event-foot">
          <span style="width:18px;height:18px;display:inline-flex;color:${color}">${icon}</span>
          <span>${rel || 'On the schedule'}</span>
          <span class="spacer"></span>
          <span class="mono">${escapeHtml(String(ev.id).slice(0, 10))}</span>
        </div>
      </article>`;
  }

  function render() {
    const grid = els.grid;
    if (!grid) return;

    if (!events.length) {
      setHTML(
        grid,
        `<div class="empty-state">
           <div class="big">📋</div>
           <h4>No announcements yet</h4>
           <p class="text-muted">Officers can publish events from the <a href="admin.html">control panel</a> (Weekly Bulletin tab).</p>
         </div>`,
      );
      return;
    }

    const list = visibleEvents();
    if (!list.length) {
      setHTML(
        grid,
        `<div class="empty-state">
           <div class="big">🔍</div>
           <h4>Nothing matches this filter</h4>
           <p class="text-muted">Try another house, clear the search box or untick “upcoming only”.</p>
         </div>`,
      );
      return;
    }

    setHTML(grid, list.map(eventCard).join(''));
  }

  /* -------------------------------- Loading -------------------------------- */

  async function load(silent) {
    if (loading) return;
    loading = true;
    if (els.refreshBtn) els.refreshBtn.disabled = true;

    try {
      const data = await API.getBulletin();
      events = Array.isArray(data) ? data : Array.isArray(data && data.events) ? data.events : [];
      renderFilters();
      render();
      setText(els.count, `${events.length} announcement${events.length === 1 ? '' : 's'}`);
      if (els.updated) setText(els.updated, `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      document.dispatchEvent(new CustomEvent('ste:bulletin', { detail: { count: events.length } }));
      if (!silent && !events.length) {
        setHTML(
          els.grid,
          `<div class="empty-state">
             <div class="big">📋</div>
             <h4>No announcements yet</h4>
             <p class="text-muted">Officers can publish events from the <a href="admin.html">control panel</a>.</p>
           </div>`,
        );
      }
    } catch (err) {
      if (els.grid && !events.length) {
        setHTML(
          els.grid,
          `<div class="empty-state">
             <div class="big">⚠️</div>
             <h4>Bulletin unavailable</h4>
             <p class="text-muted">${escapeHtml(err.message)}</p>
             <p class="text-muted mt-1" style="font-size:.8rem">
               Check that the <span class="mono">QUIZ_STORE</span> KV binding is attached to this Pages project.
             </p>
           </div>`,
        );
      }
      if (!silent) toast('Could not load the bulletin', err.message, 'bad');
    } finally {
      loading = false;
      if (els.refreshBtn) els.refreshBtn.disabled = false;
    }
  }

  /* --------------------------------- Init ---------------------------------- */

  function init() {
    els.grid = $('#bulletinGrid');
    els.filters = $('#bulletinFilters');
    els.count = $('#bulletinCount');
    els.updated = $('#bulletinUpdated');
    els.refreshBtn = $('#bulletinRefresh');
    els.search = $('#bulletinSearch');
    els.upcoming = $('#bulletinUpcoming');

    if (!els.grid) return; // not on this page

    if (els.filters) {
      els.filters.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        activeFilter = btn.dataset.filter;
        renderFilters();
        render();
        $$('[data-filter]', els.filters).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === activeFilter)));
      });
    }

    if (els.search) {
      let t = null;
      els.search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          searchTerm = els.search.value;
          render();
        }, 160);
      });
    }

    if (els.upcoming) {
      els.upcoming.addEventListener('change', () => {
        upcomingOnly = els.upcoming.checked;
        renderFilters();
        render();
      });
    }

    if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => load(false));

    load(true);
    setInterval(() => {
      if (!document.hidden) load(true);
    }, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.STE.bulletin = { load, get events() { return events; } };
})();
