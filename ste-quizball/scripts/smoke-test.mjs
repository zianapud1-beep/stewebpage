/**
 * STE Quizball — DOM smoke test (development only)
 * ---------------------------------------------------------------------------
 * Loads the three real pages in jsdom, injects the same scripts in the same
 * order the browser would, lets them talk to the running dev server and then
 * exercises the important interactions:
 *
 *   index.html    standings render, hero numbers, bulletin cards, house filter
 *                 + theme switch
 *   display.html  4 score tiles, question, countdown ring/bar, sync badge
 *   admin.html    passcode gate, live preview, score buttons, timer start,
 *                 question-bank save, bulletin publish
 *
 * Usage:
 *   npm run dev            # terminal 1 (http://127.0.0.1:8788)
 *   npm run test:smoke     # terminal 2
 *
 * The script exits non-zero if any page throws.
 * ---------------------------------------------------------------------------
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const ORIGIN = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:8788';
const PASSCODE = process.env.ADMIN_KEY || 'STE_OFFICER_2026';

const errors = [];
const OPEN_WINDOWS = [];

async function boot(page, { passcode = null, waitMs = 2500 } = {}) {
  const html = await readFile(path.join(PUBLIC, page), 'utf8');

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`[${page}] ${e.message}\n${(e.detail && e.detail.stack) || ''}`));
  vc.on('error', (...a) => errors.push(`[${page}] console.error: ${a.join(' ')}`));
  vc.on('warn', (...a) => {
    const s = a.join(' ');
    if (!/Not implemented|Could not parse CSS/.test(s)) errors.push(`[${page}] warn: ${s}`);
  });

  const dom = new JSDOM(html, {
    url: `${ORIGIN}/${page}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;

  // Route page fetch() through Node to the dev server; fill the gaps jsdom has.
  window.fetch = (input, init) => fetch(new URL(typeof input === 'string' ? input : input.url, ORIGIN).href, init);
  window.AbortController = AbortController;
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.confirm = () => true;
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  if (passcode) window.sessionStorage.setItem('ste.adminKey', passcode);

  const scripts = [...html.matchAll(/<script src="([^"]+)"\s+defer><\/script>/g)].map((m) => m[1]);
  for (const src of scripts) {
    const el = window.document.createElement('script');
    el.textContent = await readFile(path.join(PUBLIC, src), 'utf8');
    window.document.head.appendChild(el);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  if (page === 'admin.html' && passcode) {
    window.document.querySelector('#gateInput').value = passcode;
    window.document.querySelector('#gateForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  }

  await new Promise((r) => setTimeout(r, waitMs));
  OPEN_WINDOWS.push(window);
  return window;
}

const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const submit = (window, el) => el.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
function check(label, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected;
  checks.push(ok);
  console.log(`${ok ? ' ✓' : ' ✗'} ${label}: ${JSON.stringify(actual)}`);
}

/* ------------------------------- homepage -------------------------------- */
{
  const window = await boot('index.html');
  const d = window.document;
  console.log('\nindex.html');
  check('standings cards', d.querySelectorAll('.stand-card').length, 4);
  check('zeus score rendered', d.querySelector('[data-house-card="zeus"] [data-score]').textContent, (v) => v.trim() !== '');
  check('progress bar width set', d.querySelector('[data-house-card="zeus"] [data-fill]').style.width, (v) => /%$/.test(v));
  check('hero total points', d.querySelector('#statTotalPoints').textContent, (v) => v !== '0');
  check('hero leader', d.querySelector('#statLeader').textContent, (v) => v !== '—');
  check('theme switcher options', d.querySelectorAll('[data-house-btn]').length, 5);
  check('bulletin filters', d.querySelectorAll('[data-filter]').length, 5);
  check('bulletin cards', d.querySelectorAll('.event-card').length, (v) => v > 0);
  check('live strip status', d.querySelector('#quizStatusPill').textContent, (v) => v.length > 0);
  check('event count reaches hero stats', d.querySelector('#statEvents').textContent, (v) => Number(v) > 0);
  check('bulletin hint updated', d.querySelector('#bulletinHint').textContent, (v) => /event/.test(v));

  click(window, d.querySelector('[data-filter="zeus"]'));
  await wait(250);
  const zeusOnly = d.querySelectorAll('.event-card').length;
  check('ZEUS filter narrows the grid', zeusOnly <= 3, true);
  check('filter marked active', d.querySelector('.filter-btn.is-active').textContent.trim().startsWith('ZEUS'), true);

  click(window, d.querySelector('[data-house-btn="athena"]'));
  await wait(200);
  check('theme switched to athena', d.documentElement.dataset.house, 'athena');
  check('brand renamed', d.querySelector('#brandTitle').textContent, 'Athena');
}

/* -------------------------------- display -------------------------------- */
{
  const window = await boot('display.html');
  const d = window.document;
  console.log('\ndisplay.html');
  check('score tiles', d.querySelectorAll('.score-tile').length, 4);
  check('status chip present', d.querySelector('#statusChip').dataset.status, (v) => v.length > 0);
  check('question text', d.querySelector('#qText').textContent.trim(), (v) => v.length > 0);
  check('point value', d.querySelector('#qValue').textContent, (v) => /^\d+$/.test(v.trim()));
  check('timer digits', d.querySelector('#timerDigits').textContent, (v) => /^\d/.test(v));
  check('countdown ring bound', d.querySelector('#ringProg').style.strokeDashoffset !== '', true);
  check('progress bar bound', d.querySelector('#timerBarFill').style.width, (v) => /%$/.test(v));
  check('sync badge shows latency', d.querySelector('#syncText').textContent, (v) => /synced|connect/i.test(v));
  check('score tile values', d.querySelector('[data-tile="zeus"] [data-score]').textContent, (v) => v.trim() !== '');
}

/* --------------------------------- admin --------------------------------- */
{
  const window = await boot('admin.html', { passcode: PASSCODE, waitMs: 3000 });
  const d = window.document;
  console.log('\nadmin.html');
  check('gate unlocked', d.querySelector('#gate').classList.contains('is-hidden'), true);
  check('app visible', d.querySelector('#adminApp').classList.contains('hidden'), false);
  check('status buttons', d.querySelectorAll('[data-status-btn]').length, 4);
  check('timer presets', d.querySelectorAll('[data-seconds]').length, 3);
  check('score rows', d.querySelectorAll('[data-score-row]').length, 4);
  check('preview mirrors state', d.querySelector('#pmStatus').textContent, (v) => v.length > 0);
  check('question bank loaded', d.querySelectorAll('.bank-item').length, (v) => v > 0);
  check('bulletin list loaded', d.querySelectorAll('.ba-item').length, (v) => v > 0);
  check('connection indicator', d.querySelector('#connDot').textContent, 'live');

  const before = Number(d.querySelector('[data-score-row="athena"] [data-score-val]').textContent.replace(/[^\d-]/g, ''));
  click(window, d.querySelector('[data-score-row="athena"] [data-delta="10"]'));
  await wait(1400);
  const after = Number(d.querySelector('[data-score-row="athena"] [data-score-val]').textContent.replace(/[^\d-]/g, ''));
  check('+10 button adjusts the score', after - before, 10);

  click(window, d.querySelector('[data-seconds="30"]'));
  await wait(1400);
  check('30s timer opened the buzzers', d.querySelector('.status-btn.is-active')?.dataset.statusBtn, 'BUZZERS_OPEN');
  check('timer running', d.querySelector('#timerPhase').textContent, (v) => /RUNNING|PAUSED/.test(v));

  click(window, d.querySelector('#pauseBtn'));
  await wait(1200);
  check('pause freezes the clock', d.querySelector('#timerPhase').textContent, (v) => /PAUSED|READY/.test(v));

  const bankBefore = d.querySelectorAll('.bank-item').length;
  d.querySelector('#qText').value = 'Smoke test: what is the SI unit of magnetic flux?';
  d.querySelector('#qAnswer').value = 'The weber (Wb)';
  submit(window, d.querySelector('#qForm'));
  await wait(1600);
  check('question saved to the bank', d.querySelectorAll('.bank-item').length, bankBefore + 1);

  click(window, d.querySelector('[data-tab="bulletin"]'));
  await wait(150);
  check('bulletin tab opens', d.querySelector('[data-panel="bulletin"]').classList.contains('is-active'), true);

  const evBefore = d.querySelectorAll('.ba-item').length;
  d.querySelector('#evTitle').value = 'Smoke test announcement';
  d.querySelector('#evWeek').value = '9';
  d.querySelector('#evHouse').value = 'aphrodite';
  d.querySelector('#evPoints').value = '12';
  d.querySelector('#evDatetime').value = '2026-11-01T10:00';
  submit(window, d.querySelector('#evForm'));
  await wait(1600);
  check('announcement published', d.querySelectorAll('.ba-item').length, evBefore + 1);
}

OPEN_WINDOWS.forEach((w) => w.close());

console.log('\n=== page errors ===');
console.log(errors.length ? errors.join('\n') : 'none');

const failed = checks.filter((c) => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
