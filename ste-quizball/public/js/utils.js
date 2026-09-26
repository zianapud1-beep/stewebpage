/* ===========================================================================
   STE QUIZBALL — utils.js
   Shared namespace: house identities, inline SVG icons, formatting helpers,
   the fetch wrapper and the toast system.  Loaded as a plain script (not an
   ES module) so the admin panel still works when opened over file://.
   =========================================================================== */

(function () {
  'use strict';

  const STE = (window.STE = window.STE || {});
  const ADMIN_KEY_STORAGE = 'ste.adminKey';
  const HOUSE_STORAGE = 'ste.house';
  const THEME_STORAGE = 'ste.theme';

  /* ------------------------------- Houses -------------------------------- */

  const HOUSES = [
    {
      id: 'zeus',
      name: 'Zeus',
      short: 'ZEUS',
      domain: 'Electromagnetism & Physics',
      motto: 'Energy arcs, fields & lightning',
      color: '#22d3ee',
      color2: '#8b5cf6',
    },
    {
      id: 'poseidon',
      name: 'Poseidon',
      short: 'POSEIDON',
      domain: 'Fluid Mechanics & Marine Science',
      motto: 'Waves, pressure & flow',
      color: '#0ea5e9',
      color2: '#14b8a6',
    },
    {
      id: 'athena',
      name: 'Athena',
      short: 'ATHENA',
      domain: 'Robotics, AI & Computer Science',
      motto: 'Circuits, logic & code',
      color: '#cbd5e1',
      color2: '#cd7f32',
    },
    {
      id: 'aphrodite',
      name: 'Aphrodite',
      short: 'APHRODITE',
      domain: 'Organic Chemistry & Fibonacci Maths',
      motto: 'Molecules & the golden ratio',
      color: '#fb7185',
      color2: '#e8a598',
    },
  ];

  const HOUSE_IDS = HOUSES.map((h) => h.id);
  const HOUSE_MAP = HOUSES.reduce((acc, h) => ((acc[h.id] = h), acc), {});

  /** The neutral "everyone" identity used by the theme switcher + filters. */
  const STE_HOUSE = {
    id: 'ste',
    name: 'STE',
    short: 'ALL',
    domain: 'Science • Technology • Engineering',
    motto: 'All four houses',
    color: '#38bdf8',
    color2: '#a78bfa',
  };

  const THEME_HOUSES = [STE_HOUSE, ...HOUSES];
  const THEME_MAP = THEME_HOUSES.reduce((acc, h) => ((acc[h.id] = h), acc), {});
  const FILTERS = [{ id: 'all', name: 'All', color: '#94a3b8' }, ...HOUSES];

  function houseById(id) {
    return HOUSE_MAP[id] || null;
  }
  function houseOrAll(id) {
    return HOUSE_MAP[id] || STE_HOUSE;
  }
  function houseColor(id) {
    const h = HOUSE_MAP[id];
    return h ? h.color : 'var(--accent)';
  }

  /* -------------------------------- Icons -------------------------------- */

  // `width`/`height` default to 1em so an icon can never blow up the layout;
  // CSS (e.g. `.btn svg`) or an `extra` attribute string can still override it.
  const svg = (inner, extra) =>
    `<svg viewBox="0 0 24 24" width="1em" height="1em" ${extra || 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'} aria-hidden="true">${inner}</svg>`;

  const ICONS = {
    /* House emblems */
    zeus: svg('<path d="M13.4 2 5.6 13.1h5.2L9.2 22l8.4-11.6h-5.4L13.4 2Z" fill="currentColor" stroke="none"/><path d="M3.2 6.6 1.6 5m19.2 1.6L22.4 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', 'fill="none"'),
    poseidon: svg('<path d="M12 3v18M9 21h6M12 3c-2.2 0-4 1.3-4 3.4V9M12 3c2.2 0 4 1.3 4 3.4V9M4.8 6.5v2.6a7.2 7.2 0 0 0 14.4 0V6.5"/><path d="M9.6 18.4h4.8"/>'),
    athena: svg('<path d="M12 2.2 20.2 7v10L12 21.8 3.8 17V7L12 2.2Z"/><circle cx="12" cy="12" r="3.1"/><path d="M12 8.9V5.4M14.7 13.6l3 1.7M9.3 13.6l-3 1.7"/>'),
    aphrodite: svg('<circle cx="6.4" cy="16.6" r="2.9"/><circle cx="17.6" cy="16.6" r="2.9"/><circle cx="12" cy="6" r="2.9"/><path d="m10.6 8.7-2.6 5.2M13.4 8.7l2.6 5.2M9.3 16.6h5.4"/>'),

    /* UI */
    bolt: svg('<path d="M13 2 4.5 13.5H11l-1.2 8.5L18.5 10H12l1-8Z"/>'),
    trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4.5v2A3.5 3.5 0 0 0 8 10.5M17 5h2.5v2A3.5 3.5 0 0 1 16 10.5"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'),
    pin: svg('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
    spark: svg('<path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L3.5 11 10 9l2-6.5Z"/>'),
    megaphone: svg('<path d="M4 10v4a2 2 0 0 0 2 2h2l7 4V4L8 8H6a2 2 0 0 0-2 2Z"/><path d="M18.5 9a4 4 0 0 1 0 6"/>'),
    play: svg('<path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none"/>', 'fill="none"'),
    pause: svg('<path d="M8 5h3.2v14H8zM12.8 5H16v14h-3.2z" fill="currentColor" stroke="none"/>', 'fill="none"'),
    reset: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    edit: svg('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 6.5 3 3"/>'),
    trash: svg('<path d="M4 7h16M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7M6.5 7l1 13h9l1-13"/>'),
    push: svg('<path d="M12 19V5M6 11l6-6 6 6"/><path d="M4 21h16"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    lock: svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M12 15v3"/>'),
    shield: svg('<path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
    eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
    book: svg('<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5Z"/><path d="M8 6.5h8M8 10h6"/>'),
    users: svg('<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.5 5.4a3.4 3.4 0 0 1 0 6.6M18 14.6a6.2 6.2 0 0 1 3.2 4.6"/>'),
    monitor: svg('<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17v4"/>'),
    refresh: svg('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>'),
    download: svg('<path d="M12 4v11M7 11l5 5 5-5"/><path d="M4.5 20h15"/>'),
    chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 7l2.6 1.5M17.2 15.5 19.8 17M4.2 17l2.6-1.5M17.2 8.5 19.8 7"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>'),
    warn: svg('<path d="M12 3.5 21 19.5H3L12 3.5Z"/><path d="M12 10v4.2M12 17v.2"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/>'),
  };

  /* House emblem lookup that works for 'all'/'ste' too. */
  function houseIcon(id) {
    if (id === 'all' || id === 'ste' || !ICONS[id]) return ICONS.spark;
    return ICONS[id];
  }

  /* ------------------------------ Formatting ------------------------------ */

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Parse 'YYYY-MM-DDTHH:mm' as local time (never UTC-shifted). */
  function parseLocal(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value));
    const d = m
      ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
      : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** "Mon 5 Oct · 14:30" (12-hour for locales that prefer it). */
  function fmtDateTime(value) {
    const d = parseLocal(value);
    if (!d) return 'Date TBA';
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${time}`;
  }

  function fmtDate(value) {
    const d = parseLocal(value);
    if (!d) return 'TBA';
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  /** "in 3 days" / "today" / "2 weeks ago" — used on bulletin cards. */
  function relativeDay(value) {
    const d = parseLocal(value);
    if (!d) return '';
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((target - startOfToday) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 1 && days < 7) return `In ${days} days`;
    if (days < -1 && days > -7) return `${Math.abs(days)} days ago`;
    if (days >= 7) return `In ${Math.round(days / 7)} week${days >= 14 ? 's' : ''}`;
    return `${Math.round(Math.abs(days) / 7)} weeks ago`;
  }

  function fmtClock(ms) {
    const total = Math.max(0, Math.round(ms / 100) / 10);
    const s = Math.floor(total);
    const tenth = Math.floor((total - s) * 10);
    if (s >= 60) {
      const m = Math.floor(s / 60);
      return `${m}:${String(s % 60).padStart(2, '0')}`;
    }
    return `${s}.${tenth}`;
  }

  function fmtTimeOfDay(date) {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function initials(name) {
    return String(name || '?').trim().slice(0, 2).toUpperCase();
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Safe wrapper: matchMedia is missing in some embedded/older engines. */
  function prefersReducedMotion() {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /* ------------------------------ DOM helpers ----------------------------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Set textContent only when it changed (keeps the projector flicker-free). */
  function setText(el, value) {
    if (!el) return;
    const text = String(value == null ? '' : value);
    if (el.textContent !== text) el.textContent = text;
  }

  function setHTML(el, html) {
    if (!el) return;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  /* ------------------------------- Storage -------------------------------- */

  function makeStore(backing) {
    return {
      get(key, fallback) {
        try {
          const v = backing().getItem(key);
          return v === null ? fallback : v;
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          backing().setItem(key, String(value));
        } catch {
          /* private mode — ignore */
        }
      },
      remove(key) {
        try {
          backing().removeItem(key);
        } catch {
          /* ignore */
        }
      },
    };
  }

  const store = makeStore(() => window.localStorage);
  /** The officer passcode lives in sessionStorage: gone when the tab closes. */
  const session = makeStore(() => window.sessionStorage);

  /* --------------------------------- API ---------------------------------- */

  const DEFAULT_TIMEOUT = 8000;

  async function fetchJSON(url, options) {
    const opts = Object.assign({}, options);
    opts.headers = Object.assign({ accept: 'application/json' }, opts.headers || {});

    // Abort slow requests so the 500ms poll loop never stacks up.
    const controller = new AbortController();
    const timeoutMs = opts.timeout || DEFAULT_TIMEOUT;
    delete opts.timeout;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    opts.signal = controller.signal;

    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const message = (data && (data.error || data.message)) || `${res.status} ${res.statusText}`;
        const err = new Error(message);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        const e = new Error(`Request timed out after ${timeoutMs}ms`);
        e.status = 0;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  const API = {
    getState: (opts) => fetchJSON('/api/state' + (opts && opts.bank ? '?bank=1' : ''), { cache: 'no-store', timeout: (opts && opts.timeout) || 8000 }),
    postState: (body) =>
      fetchJSON('/api/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        timeout: 10000,
      }),
    getBulletin: () => fetchJSON('/api/bulletin', { cache: 'no-store' }),
    postBulletin: (body) =>
      fetchJSON('/api/bulletin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        timeout: 10000,
      }),
  };

  /* --------------------------------- Toasts ------------------------------- */

  function toastHost() {
    let host = document.getElementById('toastStack');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastStack';
      host.className = 'toast-stack';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    return host;
  }

  const TOAST_ICON = { ok: 'check', bad: 'warn', warn: 'warn', info: 'info' };

  function toast(title, body, type, ms) {
    const kind = type || 'info';
    const el = document.createElement('div');
    el.className = `toast is-${kind}`;
    el.innerHTML = `
      <span style="width:18px;height:18px;flex:0 0 auto;color:var(--${kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : kind === 'warn' ? 'warn' : 'accent'})">${ICONS[TOAST_ICON[kind] || 'info']}</span>
      <div style="min-width:0">
        <div class="t-title">${escapeHtml(title)}</div>
        ${body ? `<div class="t-body">${escapeHtml(body)}</div>` : ''}
      </div>`;
    toastHost().appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    }, ms || 3600);
    return el;
  }

  /* --------------------------- Status vocabulary --------------------------- */

  const STATUS_META = {
    IDLE: { label: 'STANDBY', short: 'Idle', tone: 'idle', icon: 'eye' },
    BUZZERS_OPEN: { label: 'BUZZERS OPEN', short: 'Buzzers open', tone: 'ok', icon: 'bolt' },
    TIME_UP: { label: 'TIME UP', short: 'Time up', tone: 'bad', icon: 'clock' },
    ANSWER_REVEALED: { label: 'ANSWER REVEALED', short: 'Answer revealed', tone: 'accent', icon: 'check' },
  };

  function statusMeta(status) {
    return STATUS_META[status] || STATUS_META.IDLE;
  }

  /* --------------------------- Scoring helper ----------------------------- */

  function leadingHouse(scores) {
    const entries = HOUSE_IDS.map((id) => [id, Number(scores && scores[id]) || 0]);
    const max = Math.max(...entries.map((e) => e[1]));
    const leaders = entries.filter((e) => e[1] === max).map((e) => e[0]);
    return { leaders, max, tie: leaders.length > 1 || max === 0 };
  }

  function sortByScore(scores) {
    return HOUSES.map((h) => ({ house: h, points: Number(scores && scores[h.id]) || 0 })).sort(
      (a, b) => b.points - a.points || a.house.name.localeCompare(b.house.name),
    );
  }

  /* ------------------------------ Admin key -------------------------------- */

  const admin = {
    get: () => session.get(ADMIN_KEY_STORAGE, ''),
    set: (key) => session.set(ADMIN_KEY_STORAGE, key),
    clear: () => session.remove(ADMIN_KEY_STORAGE),
  };

  /* -------------------------------- Export -------------------------------- */

  Object.assign(STE, {
    HOUSES,
    HOUSE_IDS,
    HOUSE_MAP,
    STE_HOUSE,
    THEME_HOUSES,
    THEME_MAP,
    FILTERS,
    houseById,
    houseOrAll,
    houseColor,
    houseIcon,
    ICONS,
    svg,
    escapeHtml,
    parseLocal,
    fmtDateTime,
    fmtDate,
    relativeDay,
    fmtClock,
    fmtTimeOfDay,
    initials,
    clamp,
    sleep,
    prefersReducedMotion,
    $,
    $$,
    setText,
    setHTML,
    store,
    session,
    fetchJSON,
    API,
    toast,
    STATUS_META,
    statusMeta,
    leadingHouse,
    sortByScore,
    admin,
    STORAGE: { HOUSE_STORAGE, THEME_STORAGE, ADMIN_KEY_STORAGE },
  });
})();
