/**
 * /api/state — Live Quizball state  (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * KV binding : QUIZ_STORE
 *   current_state  → the live quiz-state object (read by every display screen)
 *   question_bank  → the officers' saved question bank (optional extra)
 *
 * GET  /api/state           → current state JSON  (+ serverNow clock anchor)
 * GET  /api/state?bank=1    → same, plus the question bank (admin panel only)
 * POST /api/state           → { adminKey, patch | state, questionBank? }
 *
 * All responses are `no-store`; the projector polls this endpoint every 500ms.
 * ---------------------------------------------------------------------------
 */

const DEFAULT_ADMIN_KEY = 'STE_OFFICER_2026';
const STATE_KEY = 'current_state';
const BANK_KEY = 'question_bank';

const HOUSE_IDS = ['zeus', 'poseidon', 'athena', 'aphrodite'];
const STATUSES = ['IDLE', 'BUZZERS_OPEN', 'TIME_UP', 'ANSWER_REVEALED'];

const MAX_TEXT = 700;
const MAX_BANK = 300;
const MAX_TIMER_MS = 60 * 60 * 1000; // 1 hour ceiling for a single question
const MAX_POINTS = 1000;
const MAX_SCORE = 100000;
const MAX_BODY_BYTES = 512 * 1024;

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

/** Constant-time-ish string comparison (avoids leaking the key via timing). */
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

function str(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  // Strip control characters that would break a projector layout.
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
}

function int(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return fallback;
}

function pickStatus(value, fallback = 'IDLE') {
  const s = String(value ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  return STATUSES.includes(s) ? s : fallback;
}

/* --------------------------- state normalisation -------------------------- */

function defaultScores() {
  return { zeus: 0, poseidon: 0, athena: 0, aphrodite: 0 };
}

function defaultState() {
  const now = Date.now();
  return {
    status: 'IDLE',
    round: 'Round 1',
    questionNumber: 0,
    category: 'General STE',
    questionText: 'Awaiting the first question — officers, take the stage.',
    answer: '',
    points: 10,
    revealAnswer: false,
    timer: { durationMs: 30000, running: false, endsAt: null, remainingMs: 30000 },
    scores: defaultScores(),
    version: 1,
    updatedAt: now,
    updatedBy: 'system',
  };
}

function normalizeTimer(raw, prev) {
  const base = prev || { durationMs: 30000, running: false, endsAt: null, remainingMs: 30000 };
  if (!raw || typeof raw !== 'object') return { ...base };

  const durationMs = int(raw.durationMs, base.durationMs, 1000, MAX_TIMER_MS);
  const running = bool(raw.running, base.running);

  // `null` / `undefined` mean "not supplied"; only a real positive timestamp
  // counts as a deadline, otherwise we recompute it from `remainingMs`.
  const endsCandidate = Number(raw.endsAt);
  const hasEnds = raw.endsAt !== null && raw.endsAt !== undefined && Number.isFinite(endsCandidate) && endsCandidate > 0;
  const remainingCandidate = Number(raw.remainingMs);
  const hasRemaining = raw.remainingMs !== null && raw.remainingMs !== undefined && Number.isFinite(remainingCandidate);

  let endsAt = hasEnds ? endsCandidate : null;
  let remainingMs = hasRemaining ? int(remainingCandidate, base.remainingMs, 0, MAX_TIMER_MS) : int(base.remainingMs, durationMs, 0, MAX_TIMER_MS);

  if (running) {
    // A running timer is always expressed as an absolute deadline. An expired
    // deadline is KEPT here (remaining 0) so withExpiryOverlay() can see that
    // the board ran out of time and report TIME_UP to every reader.
    if (!endsAt) endsAt = Date.now() + (remainingMs || durationMs);
    remainingMs = Math.max(0, endsAt - Date.now());
  } else {
    endsAt = null;
  }

  return { durationMs, running, endsAt, remainingMs };
}

function normalizeScores(raw, prev) {
  const base = prev || defaultScores();
  const out = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  HOUSE_IDS.forEach((id) => {
    out[id] = int(source[id], base[id] ?? 0, -MAX_SCORE, MAX_SCORE);
  });
  return out;
}

function normalizeQuestion(raw, prev) {
  const base = prev || defaultState();
  if (!raw || typeof raw !== 'object') return { ...base };
  return {
    round: str(raw.round ?? base.round, 60) || base.round,
    questionNumber: int(raw.questionNumber, base.questionNumber, 0, 9999),
    category: str(raw.category ?? base.category, 80) || base.category,
    questionText: str(raw.questionText ?? base.questionText, MAX_TEXT),
    answer: str(raw.answer ?? base.answer, MAX_TEXT),
    points: int(raw.points, base.points, 0, MAX_POINTS),
    revealAnswer: bool(raw.revealAnswer, base.revealAnswer),
  };
}

/**
 * Merge a partial patch over a known-good state and return a complete state.
 * `bump: true` (writes only) increments the version + timestamp so polling
 * clients can tell a real change from a repeated read.
 */
function normalizeState(input, prev, bump = false) {
  const base = prev || defaultState();
  const raw = input && typeof input === 'object' ? input : {};
  const question = normalizeQuestion(raw, base);

  return {
    ...question,
    status: pickStatus(raw.status, base.status),
    timer: normalizeTimer(raw.timer, base.timer),
    scores: normalizeScores(raw.scores, base.scores),
    version: bump ? int(raw.version, base.version, 0, 1e9) + 1 : int(raw.version, base.version, 0, 1e9),
    updatedAt: bump ? Date.now() : int(raw.updatedAt, base.updatedAt, 0, 1e15) || Date.now(),
    updatedBy: str(raw.updatedBy, 40) || base.updatedBy || 'officer',
  };
}

function normalizeBank(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_BANK).map((q, i) => {
    const item = q && typeof q === 'object' ? q : {};
    return {
      id: str(item.id, 64) || `q_${Date.now().toString(36)}_${i}`,
      round: str(item.round, 60) || 'Round 1',
      category: str(item.category, 80) || 'General STE',
      questionText: str(item.questionText, MAX_TEXT),
      answer: str(item.answer, MAX_TEXT),
      points: int(item.points, 10, 0, MAX_POINTS),
      house: HOUSE_IDS.includes(item.house) ? item.house : 'all',
    };
  }).filter((q) => q.questionText.length > 0);
}

/**
 * Read-only convenience: exposes an already-expired BUZZERS_OPEN timer as
 * TIME_UP in the response. Nothing is written to KV from a GET.
 */
function withExpiryOverlay(state, now) {
  if (state.status === 'BUZZERS_OPEN' && state.timer.running && state.timer.endsAt && state.timer.endsAt <= now) {
    return {
      ...state,
      status: 'TIME_UP',
      expired: true,
      timer: { ...state.timer, running: false, endsAt: null, remainingMs: 0 },
    };
  }
  return { ...state, expired: false };
}

/* -------------------------------- handlers -------------------------------- */

export async function onRequestGet({ request, env }) {
  const kv = env && env.QUIZ_STORE;
  if (!kv) {
    return fail('KV binding "QUIZ_STORE" is missing. Add it to your Pages project (Settings → Functions → KV namespace bindings) or wrangler.toml.', 500);
  }

  const url = new URL(request.url);
  const wantBank = url.searchParams.get('bank') === '1';

  let stored = null;
  let bank = [];
  try {
    const [rawState, rawBank] = await Promise.all([
      kv.get(STATE_KEY),
      wantBank ? kv.get(BANK_KEY) : Promise.resolve(null),
    ]);
    stored = safeParse(rawState);
    if (wantBank) bank = normalizeBank(safeParse(rawBank));
  } catch (err) {
    return fail(`KV read failed: ${err && err.message ? err.message : 'unknown error'}`, 502);
  }

  const now = Date.now();
  const state = withExpiryOverlay(normalizeState(stored || {}, defaultState()), now);

  const payload = { ...state, ok: true, serverNow: now };
  if (wantBank) payload.questionBank = bank;
  return json(payload);
}

export async function onRequestPost({ request, env }) {
  if (request.method !== 'POST') return fail('Method not allowed', 405);

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

  // Cheap passcode probe used by the admin gate (no KV write).
  if (body.action === 'verify') {
    return json({ ok: true, verified: true, serverNow: Date.now() });
  }

  let stored = null;
  try {
    stored = safeParse(await kv.get(STATE_KEY));
  } catch (err) {
    return fail(`KV read failed: ${err && err.message ? err.message : 'unknown error'}`, 502);
  }

  const current = stored ? normalizeState(stored, defaultState()) : defaultState();

  // `state` replaces wholesale, `patch` merges over the current state.
  let merged;
  if (body.state && typeof body.state === 'object') {
    merged = normalizeState(body.state, current, true);
  } else {
    const patch = body.patch && typeof body.patch === 'object' ? body.patch : body;
    // Shallow-merge the nested objects so a patch may update just one score.
    merged = normalizeState(
      {
        ...current,
        ...patch,
        timer: patch.timer ? { ...current.timer, ...patch.timer } : current.timer,
        scores: patch.scores ? { ...current.scores, ...patch.scores } : current.scores,
      },
      current,
      true,
    );
  }

  merged.updatedBy = str(body.updatedBy, 40) || 'officer';

  try {
    await kv.put(STATE_KEY, JSON.stringify(merged));
    if (Array.isArray(body.questionBank)) {
      await kv.put(BANK_KEY, JSON.stringify(normalizeBank(body.questionBank)));
    }
  } catch (err) {
    return fail(`KV write failed: ${err && err.message ? err.message : 'unknown error'}`, 502);
  }

  const now = Date.now();
  const payload = { ...withExpiryOverlay(merged, now), ok: true, serverNow: now };
  if (Array.isArray(body.questionBank)) payload.questionBank = normalizeBank(body.questionBank);
  return json(payload);
}

/** Anything other than GET/POST. */
export async function onRequest({ request }) {
  if (request.method === 'GET' || request.method === 'POST') return;
  return fail('Method not allowed. Use GET to read or POST to update the state.', 405);
}
