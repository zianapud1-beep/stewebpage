/**
 * /api/bulletin — Weekly announcements board  (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * KV binding : QUIZ_STORE
 *   weekly_bulletin → JSON array of event objects
 *
 * GET  /api/bulletin          → the array of events (pinned first, then week)
 * POST /api/bulletin          → { adminKey, events }          replace all
 *                               { adminKey, event }           upsert one (by id)
 *                               { adminKey, deleteId }        delete one
 *
 * Event object
 * {
 *   id, title, week, house ('all'|'zeus'|'poseidon'|'athena'|'aphrodite'),
 *   category, datetime ('YYYY-MM-DDTHH:mm'), location, points, description,
 *   pinned, createdAt, updatedAt
 * }
 * ---------------------------------------------------------------------------
 */

const DEFAULT_ADMIN_KEY = 'STE_OFFICER_2026';
const BULLETIN_KEY = 'weekly_bulletin';

const HOUSE_IDS = ['zeus', 'poseidon', 'athena', 'aphrodite'];
const MAX_EVENTS = 200;
const MAX_BODY_BYTES = 512 * 1024;
const TEXT_LIMITS = { title: 140, category: 40, location: 80, description: 900 };

/* ----------------------------- tiny helpers ------------------------------ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'cdn-cache-control': 'no-store',
    },
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function safeParse(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function keysMatch(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function adminKeyOf(env) {
  return (env && env.ADMIN_KEY) || DEFAULT_ADMIN_KEY;
}

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max).trim();
}

function int(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `evt_${crypto.randomUUID().slice(0, 18)}`;
  } catch {
    /* fall through */
  }
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Accepts 'YYYY-MM-DDTHH:mm', ISO strings or anything the Date parser likes. */
function normalizeDateTime(value) {
  const raw = str(value, 40);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeEvent(raw, prev) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const base = prev && typeof prev === 'object' ? prev : {};
  const now = Date.now();

  const home = str(item.house, 20).toLowerCase();
  return {
    id: str(item.id, 64) || base.id || newId(),
    title: str(item.title ?? base.title, TEXT_LIMITS.title) || 'Untitled event',
    week: int(item.week ?? base.week, 1, 0, 99),
    house: HOUSE_IDS.includes(home) ? home : 'all',
    category: str(item.category ?? base.category, TEXT_LIMITS.category) || 'General',
    datetime: normalizeDateTime(item.datetime ?? base.datetime),
    location: str(item.location ?? base.location, TEXT_LIMITS.location),
    points: int(item.points ?? base.points, 0, -999, 9999),
    description: str(item.description ?? base.description, TEXT_LIMITS.description),
    pinned: item.pinned === undefined ? Boolean(base.pinned) : Boolean(item.pinned),
    createdAt: int(item.createdAt ?? base.createdAt, now, 0, 1e15),
    updatedAt: now,
  };
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.week !== b.week) return a.week - b.week;
    const at = a.datetime || '9999';
    const bt = b.datetime || '9999';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
 
  const seen = new Set();
  return raw
    .slice(0, MAX_EVENTS)
    .map((e) => normalizeEvent(e, null))
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
}

async function readEvents(kv) {
  const raw = safeParse(await kv.get(BULLETIN_KEY));
  return normalizeList(Array.isArray(raw) ? raw : []);
}

/* -------------------------------- handlers -------------------------------- */

export async function onRequestGet({ env }) {
  const kv = env && env.QUIZ_STORE;
  if (!kv) {
    return fail('KV binding "QUIZ_STORE" is missing. Add it to your Pages project (Settings → Functions → KV namespace bindings) or wrangler.toml.', 500);
  }

  try {
    const events = await readEvents(kv);
    // The spec asks for an array — and that is exactly what we return.
    return json(sortEvents(events));
  } catch (err) {
    return fail(`KV read failed: ${err && err.message ? err.message : 'unknown error'}`, 502);
  }
}

export async function onRequestPost({ request, env }) {
  const kv = env && env.QUIZ_STORE;
  if (!kv) {
    return fail('KV binding "QUIZ_STORE" is missing. Add it to your Pages project or wrangler.toml.', 500);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return fail('Request body is too large.', 413);

  const body = safeParse(raw);
  if (!body || typeof body !== 'object') return fail('Expected a JSON body.', 400);

  if (!keysMatch(body.adminKey, adminKeyOf(env))) {
    return fail('Invalid admin passcode.', 401);
  }

  try {
    let events = await readEvents(kv);

    if (Array.isArray(body.events)) {
      // Full replace (spec behaviour).
      events = normalizeList(body.events);
    } else if (body.event && typeof body.event === 'object') {
      // Surgical upsert — safe when several officers edit at the same time.
      const incoming = normalizeEvent(body.event, null);
      const idx = events.findIndex((e) => e.id === incoming.id);
      if (idx === -1) events = [...events, incoming];
      else events = events.map((e, i) => (i === idx ? normalizeEvent(body.event, e) : e));
    } else if (typeof body.deleteId === 'string') {
      const before = events.length;
      events = events.filter((e) => e.id !== body.deleteId);
      if (events.length === before) return fail('No event with that id.', 404);
    } else {
      return fail('Provide `events` (replace all), `event` (upsert one) or `deleteId`.', 400);
    }

    events = sortEvents(events);
    await kv.put(BULLETIN_KEY, JSON.stringify(events));
    return json({ ok: true, count: events.length, events });
  } catch (err) {
    return fail(`KV write failed: ${err && err.message ? err.message : 'unknown error'}`, 502);
  }
}

export async function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'POST') return;
  return fail('Method not allowed. Use GET to read or POST to update the bulletin.', 405);
}
