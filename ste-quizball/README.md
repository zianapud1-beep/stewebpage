# ⚡ STE Quizball — Live House Championship & Weekly Bulletin

A complete, lightweight, production-ready web app for an STE (Science, Technology & Engineering)
school event. Four student houses — **Zeus**, **Poseidon**, **Athena** and **Aphrodite** — compete
for points on a live scoreboard while officers drive a Mass Quizball from a phone or laptop.

Built with **raw HTML5 + CSS3 + vanilla ES6 JavaScript** and **Cloudflare Pages Functions** with a
**Cloudflare KV** namespace (`QUIZ_STORE`). No frameworks, no bundler, no build step.

```
ste-quizball/
├── public/                     ← the static site (Cloudflare Pages output dir)
│   ├── index.html              # landing page: standings, live quiz, weekly bulletin
│   ├── display.html            # projector screen, polls the state every 500 ms
│   ├── admin.html              # officer control panel (passcode protected)
│   ├── css/styles.css          # design tokens, 4 house themes, responsive + projector layouts
│   └── js/
│       ├── utils.js            # shared namespace: houses, icons, formatting, fetch, toasts
│       ├── main.js             # theme switcher + live standings
│       ├── display.js          # polling sync engine for the projector
│       ├── admin.js            # status/timer/score controls, question bank, bulletin editor
│       └── bulletin.js         # bulletin loading + house filtering
├── functions/api/
│   ├── state.js                # GET/POST live quiz state  → KV key `current_state`
│   └── bulletin.js             # GET/POST announcements    → KV key `weekly_bulletin`
├── seed/                       # optional starter data (state, bulletin, question bank)
├── scripts/smoke-test.mjs      # DOM smoke test for all three pages (dev only)
├── dev-server.mjs              # zero-dependency local server that runs the real Functions
├── wrangler.toml               # Pages config + QUIZ_STORE KV binding
└── package.json
```

### Why there is no build step

`functions/api/*.js` are genuine ES modules (`export async function onRequestGet`) — the
Workers runtime requires that. The browser code is written as plain ES6+ **deferred
scripts** sharing one `window.STE` namespace instead of `import`/`export`:

* ES modules are blocked by CORS on `file://`, so the classic scripts keep
  `index.html` / `display.html` / `admin.html` openable straight from a folder
  (handy when a teacher wants to inspect the board without a terminal);
* there is no bundler to resolve bare specifiers, and relative-path modules on Pages
  add nothing here — the whole shared layer is one 300-line `utils.js`;
* it keeps the deployment story as simple as the spec asks: upload `public/`, done.

Every API call still goes through the Fetch API, all theming is CSS Custom Properties,
and the markup is plain HTML5. If you prefer real modules, renaming each file’s IIFE
wrapper to `export`s and loading the pages with `<script type="module">` is a purely
mechanical change — nothing else has to move.

---

## 1. Quick start (local)

```bash
cd ste-quizball
npm install          # only needed for the optional local tooling
npm run dev          # → http://localhost:8788   (no Cloudflare account required)
```

`npm run dev` starts `dev-server.mjs`, which serves `public/` **and** executes the real
`functions/api/*.js` handlers with an in-memory KV shim (seeded from `seed/`, persisted to
`.dev-kv.json` between restarts).

Officer passcode: **`STE_OFFICER_2026`**

| Page | URL | Purpose |
| --- | --- | --- |
| Landing | `/` | House standings, live quiz strip, weekly bulletin |
| Display | `/display.html` | Projector screen (press `F` for fullscreen, `H` to hide the footer) |
| Admin | `/admin.html` | Officer control panel (passcode gate) |

Other useful scripts:

```bash
npm run preview      # wrangler pages dev public --kv QUIZ_STORE  (real Workers runtime)
npm run test:smoke   # jsdom smoke test of all three pages (needs the dev server running)
```

---

## 2. Deploying to Cloudflare Pages

### 2.1 Create the KV namespace

```bash
npx wrangler login
npx wrangler kv namespace create QUIZ_STORE
```

Copy the printed `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "QUIZ_STORE"
id = "your-namespace-id"
preview_id = "your-namespace-id"
```

### 2.2 Option A — Git integration (recommended)

1. Push this repository to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings: **Framework preset: None**, **Build command: (empty)**,
   **Build output directory: `ste-quizball/public`** (or set the repo root to `ste-quizball`).
4. After the first deploy: **Settings → Functions → KV namespace bindings → Add**
   → Variable name `QUIZ_STORE` → pick your namespace → save and redeploy.
5. Optional: **Settings → Environment variables** → `ADMIN_KEY = your-own-passcode`
   (add it to both *Production* and *Preview*). Without it the app falls back to
   `STE_OFFICER_2026`.

### 2.3 Option B — Direct upload from the CLI

```bash
npm run deploy        # wrangler pages deploy public
```

Then bind KV in the dashboard exactly as in step 4 above (CLI uploads cannot create
bindings by themselves), or keep using `wrangler.toml` with the Pages project created
via `wrangler pages project create ste-quizball`.

### 2.4 What ships in `public/`

* `_routes.json` — only `/api/*` invokes a Function, so static assets never consume
  Function requests.
* `_headers` — sane caching (`no-store` for the API, short-lived for HTML) and
  `nosniff`/referrer hardening. No `X-Frame-Options`, so the board can still be embedded
  in a hall dashboard if a teacher wants that.

---

## 3. Branding & themes

Themes are pure CSS Custom Properties switched by two attributes on `<html>`:

```html
<html data-house="zeus" data-theme="dark">
```

| House | Domain | Palette | Motif |
| --- | --- | --- | --- |
| **Zeus** | Electromagnetism & Physics | Cyan `#22d3ee` → Violet `#8b5cf6` | sweeping energy arcs |
| **Poseidon** | Fluid Mechanics & Marine Science | Ocean blue `#0ea5e9` → Teal `#14b8a6` | layered swells |
| **Athena** | Robotics, AI & Computer Science | Silver `#cbd5e1` → Bronze `#cd7f32` | hex / circuit mesh |
| **Aphrodite** | Organic Chemistry & Fibonacci Maths | Rose gold `#fb7185` → Crimson `#e8a598` | molecular bonds |

`ste` is the neutral fifth option (STE overall). The header switcher writes
`localStorage['ste.house']`, so the projector screen inherits the same theme; append
`?theme=athena` to any URL to force one for a single screen.

All colour, spacing and typography tokens live in `:root` at the top of `css/styles.css`,
followed by the house blocks — change a hue once and every page follows.

---

## 4. API reference

Every response is JSON with `cache-control: no-store`. Writes must include the officer
passcode as `adminKey`; a mismatch returns **401**.

### `GET /api/state`

```jsonc
{
  "status": "BUZZERS_OPEN",          // IDLE | BUZZERS_OPEN | TIME_UP | ANSWER_REVEALED
  "round": "Round 2 · Electromagnetism",
  "questionNumber": 3,
  "category": "Electromagnetism",
  "questionText": "A 2 m conductor carrying 4 A …",
  "answer": "F = BIL sin θ = 2 N",
  "points": 20,
  "revealAnswer": false,
  "timer": { "durationMs": 30000, "running": true, "endsAt": 1790436681312, "remainingMs": 1970 },
  "scores": { "zeus": 145, "poseidon": 120, "athena": 165, "aphrodite": 95 },
  "version": 13,
  "updatedAt": 1790436680000,
  "updatedBy": "officer",
  "expired": false,
  "serverNow": 1790436680200
}
```

* `?bank=1` also returns `questionBank` (used by the admin panel only).
* **Timekeeping is deadline based.** The server never mutates state on a read; when
  `status === "BUZZERS_OPEN"` and the deadline has passed, the response reports
  `status: "TIME_UP"` and `expired: true` on the fly, so every screen agrees even if no
  officer presses a button.
* `serverNow` lets clients measure their clock offset (`serverNow + rtt/2 - Date.now()`),
  which is what drives the projector countdown at 60 fps between polls.

### `POST /api/state`

```jsonc
{ "adminKey": "STE_OFFICER_2026", "patch": { "scores": { "zeus": 155 } }, "updatedBy": "Ms Adeyemi" }
```

* `patch` — deep-merges the given keys over the stored state (nested `timer`/`scores`
  merge key by key, so `{"scores":{"zeus":155}}` leaves the other houses alone).
* `state` — replaces the whole state (validated and normalised).
* `questionBank` — array; when present it is written to the KV key `question_bank`.
* `action: "verify"` — cheap passcode probe for the admin gate; returns
  `{ "ok": true, "verified": true }` without touching KV.

Starting a timer is a single patch — the server computes the deadline:

```jsonc
{ "adminKey": "STE_OFFICER_2026",
  "patch": { "status": "BUZZERS_OPEN",
             "timer": { "durationMs": 30000, "running": true, "remainingMs": 30000, "endsAt": null } } }
```

### `GET /api/bulletin`

Returns a **flat JSON array** (sorted: pinned first, then week, then date):

```jsonc
[{ "id": "evt_quizball_final", "title": "Mass Quizball — Grand Final", "week": 3,
   "house": "all", "category": "Quizball", "datetime": "2026-10-15T09:00",
   "location": "Main Hall", "points": 120, "description": "…",
   "pinned": true, "createdAt": 1758700000000, "updatedAt": 1758700000000 }]
```

`datetime` is a local-time `YYYY-MM-DDTHH:mm` string — it is never timezone-shifted.

### `POST /api/bulletin`

```jsonc
{ "adminKey": "…", "event": { … } }     // upsert one event (by id; new id when omitted)
{ "adminKey": "…", "deleteId": "evt_…" }// delete one event
{ "adminKey": "…", "events": [ … ] }    // replace the whole board
```

Returns `{ "ok": true, "count": n, "events": [ … ] }`. The per-event form is safe when two
officers edit at the same time; the batch form is what the JSON import uses.

---

## 5. Officer workflow

**Mass Quizball tab**

1. Type your name (it is stamped on every write as `updatedBy`).
2. Pick a question from the bank → **Push to display now** (tick *Open buzzers* for a
   one-click round), or write a new question and save it to the bank first.
3. **10s / 30s / 60s** starts the countdown and opens the buzzers; **Pause/Resume**
   freezes the clock at the exact remaining time; **Reset** returns to standby at the
   last-used duration.
4. **Time up** locks the board, **Reveal answer** shows the stored answer on the display.
5. Award points with `+10`, `−10`, a custom ± amount, or **Reset all to 0**.
6. Keyboard shortcuts for the control desk: `B` buzzers, `T` time up, `A` answer,
   `R` reset, `1`/`2`/`3` = 10/30/60 s (ignored while typing in a field).

**Weekly Bulletin tab**

Create events with title, week #, target house, category, date/time, location, points and
description; pin the ones students must not miss. Edit, delete or pin from the list.
Export/import the whole board as JSON — handy for backing up before an event.

**Projector screen** — open `/display.html` on the hall machine and press `F` for
fullscreen. It shows the four scores, question number, category, text, point value, an
animated ring + bar countdown, and the status chip (`BUZZERS OPEN`, `TIME UP`,
`ANSWER REVEALED`). The footer shows poll latency and the state version so you can prove
the screen is live.

---

## 6. Reliability notes

* **Polling:** the display short-polls `GET /api/state` every **500 ms** (one request at a
  time, 4 s timeout, recursive `setTimeout` so slow responses can never stack up). The
  homepage polls every 4 s, the admin every 1.5 s, and all three stop while the tab is
  hidden. Every poll is cached-busted and `no-store`, so the board never shows stale data.
* **Scores** are clamped to ±100 000, points to 0–1000, text to 700 characters; control
  characters are stripped so a stray paste cannot break the projector layout.
* **Writes are serialised** in the admin UI (one in-flight request at a time) and the
  server bumps a `version` on every accepted write.
* **Failure states** are explicit: a missing `QUIZ_STORE` binding returns HTTP 500 with a
  message naming the binding, an unreachable API turns the homepage notice and the display
  sync badge amber → red, and an expired session re-opens the passcode gate.
* **Accessibility:** keyboard-reachable controls, `aria-live` status regions, visible focus
  rings, `prefers-reduced-motion` support, and text contrast tuned for both themes.

## 7. Before the event (checklist)

- [ ] `QUIZ_STORE` bound in Cloudflare Pages → both Production and Preview.
- [ ] `ADMIN_KEY` environment variable set to a passcode that is *not* in the source.
- [ ] Deploy done, then open `/admin.html`, unlock, push one test question, award a test
      point, and confirm it lands on `/display.html` within a second.
- [ ] Post the real week 1 announcements, then delete the test ones.
- [ ] Open the display on the hall machine, press `F`, and check the countdown from the
      back of the room.

## 8. License

MIT — free to adapt for your own school event.
