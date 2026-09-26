#!/usr/bin/env node
/**
 * STE Quizball — zero-dependency local development server.
 * ---------------------------------------------------------------------------
 * Cloudflare Pages serves `public/` as static assets and runs the files in
 * `functions/` as Workers. This script reproduces that behaviour with plain
 * Node, so the site can be developed and demoed without Wrangler:
 *
 *   • serves everything in public/ (index.html, display.html, admin.html, …)
 *   • mounts functions/api/*.js using the exact Pages Function contract
 *     (onRequestGet / onRequestPost / onRequest with { request, env, params })
 *   • provides an in-memory QUIZ_STORE KV shim (optionally seeded from
 *     seed/*.json and persisted to .dev-kv.json between restarts)
 *
 * Usage:  node dev-server.mjs          → http://0.0.0.0:8788
 *         PORT=3000 node dev-server.mjs
 * ---------------------------------------------------------------------------
 */

import http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const FUNCTIONS_DIR = path.join(ROOT, 'functions');
const SEED_DIR = path.join(ROOT, 'seed');
const KV_FILE = path.join(ROOT, '.dev-kv.json');
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/* ------------------------------- KV shim -------------------------------- */

class MemoryKV {
  constructor(initial) {
    this.map = new Map(Object.entries(initial || {}));
  }
  async get(key, options) {
    const value = this.map.has(key) ? this.map.get(key) : null;
    if (value === null) return null;
    if (options && options.type === 'json') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
  }
  async put(key, value) {
    this.map.set(key, String(value));
    scheduleFlush();
    return undefined;
  }
  async delete(key) {
    this.map.delete(key);
    scheduleFlush();
  }
  async list() {
    return { keys: [...this.map.keys()].map((name) => ({ name })), list_complete: true };
  }
  snapshot() {
    return Object.fromEntries(this.map.entries());
  }
}

let flushTimer = null;
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    try {
      await writeFile(KV_FILE, JSON.stringify(kv.snapshot(), null, 2));
    } catch {
      /* non-fatal */
    }
  }, 400);
}

async function bootstrapKV() {
  if (existsSync(KV_FILE)) {
    try {
      return JSON.parse(await readFile(KV_FILE, 'utf8'));
    } catch {
      /* fall through to the seed */
    }
  }
  const initial = {};
  for (const [key, file] of [
    ['current_state', 'state.json'],
    ['weekly_bulletin', 'bulletin.json'],
    ['question_bank', 'questions.json'],
  ]) {
    const seedFile = path.join(SEED_DIR, file);
    if (existsSync(seedFile)) initial[key] = await readFile(seedFile, 'utf8');
  }
  return initial;
}

const kv = new MemoryKV(await bootstrapKV());
const env = {
  QUIZ_STORE: kv,
  ADMIN_KEY: process.env.ADMIN_KEY || 'STE_OFFICER_2026',
};

/* --------------------------- Functions loader --------------------------- */

const moduleCache = new Map();

async function loadFunction(relPath) {
  const abs = path.join(FUNCTIONS_DIR, relPath);
  if (!existsSync(abs)) return null;
  const info = await stat(abs);
  const cached = moduleCache.get(abs);
  if (cached && cached.mtime === info.mtimeMs) return cached.mod;

  // cache-busting query keeps the ESM loader honest while hot reloading
  const mod = await import(`${pathToFileURL(abs).href}?v=${info.mtimeMs}`);
  moduleCache.set(abs, { mtime: info.mtimeMs, mod });
  return mod;
}

/** Map a URL path to a file inside functions/ (mirrors Pages routing rules). */
async function resolveFunction(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const candidates = [`${clean}.js`, `${clean}/index.js`];
  for (const candidate of candidates) {
    const abs = path.join(FUNCTIONS_DIR, candidate);
    if (existsSync(abs)) return { rel: candidate.replace(/^\//, ''), mod: await loadFunction(candidate.replace(/^\//, '')) };
  }
  return null;
}

const METHODS = { GET: 'onRequestGet', POST: 'onRequestPost', PUT: 'onRequestPut', PATCH: 'onRequestPatch', DELETE: 'onRequestDelete', OPTIONS: 'onRequestOptions', HEAD: 'onRequestHead' };

async function runFunction(mod, request) {
  const handler = mod[METHODS[request.method]] || mod.onRequest;
  if (typeof handler !== 'function') {
    return new Response(JSON.stringify({ ok: false, error: `No handler for ${request.method}` }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }
  const context = {
    request,
    env,
    params: {},
    data: {},
    functionPath: new URL(request.url).pathname,
    waitUntil: () => {},
    next: async () => new Response('Not found', { status: 404 }),
  };
  return handler(context);
}

/* ----------------------------- HTTP plumbing ---------------------------- */

const HOP_BY_HOP = new Set(['transfer-encoding', 'connection', 'keep-alive', 'content-length', 'upgrade']);

async function sendWebResponse(nodeRes, webRes) {
  const headers = {};
  webRes.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  });
  // Allow the proxied preview host to frame/embed the pages.
  delete headers['x-frame-options'];
  const body = Buffer.from(await webRes.arrayBuffer());
  nodeRes.writeHead(webRes.status, headers);
  nodeRes.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function serveStatic(pathname, res) {
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(filePath) && (await stat(filePath)).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  } else if (!existsSync(filePath) && !path.extname(filePath)) {
    const withHtml = `${filePath}.html`;
    if (existsSync(withHtml)) filePath = withHtml;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#060a13;color:#eef3fb;padding:3rem">
       <h1>404 — not found</h1><p style="color:#98a8c0">${pathname}</p>
       <p><a style="color:#22d3ee" href="/">Back to the board</a></p></body>`,
    );
    return;
  }

  const body = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  try {
    const fn = await resolveFunction(pathname);
    if (fn && fn.mod) {
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
      const webRequest = new Request(url.href, {
        method: req.method,
        headers: Object.entries(req.headers)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, v]),
        body,
      });
      const webRes = await runFunction(fn.mod, webRequest);
      await sendWebResponse(res, webRes);
      console.log(`${req.method} ${pathname} → ${webRes.status} (function)`);
      return;
    }

    await serveStatic(pathname, res);
    if (!pathname.startsWith('/api')) console.log(`${req.method} ${pathname} → 200 (static)`);
  } catch (err) {
    console.error('[dev-server]', err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ⚡  STE Quizball dev server`);
  console.log(`      http://localhost:${PORT}`);
  console.log(`      QUIZ_STORE  → in-memory KV (${kv.map.size} keys${existsSync(KV_FILE) ? ', restored from .dev-kv.json' : ', seeded from seed/'})`);
  console.log(`      passcode    → ${env.ADMIN_KEY}\n`);
});

export { server, kv, env };
