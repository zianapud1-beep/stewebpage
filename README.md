# stewebpage

School event web apps. The main project in this repository is:

## ⚡ [ste-quizball](./ste-quizball) — STE Quizball & Weekly Bulletin

A complete, lightweight, production-ready web app for an STE (Science, Technology &
Engineering) school event. Four student houses — **Zeus** (Electromagnetism/Physics),
**Poseidon** (Fluid Mechanics/Marine Science), **Athena** (Robotics/AI/CS) and
**Aphrodite** (Organic Chemistry/Fibonacci Maths) — compete for points on a live
scoreboard while officers run a Mass Quizball from a phone or laptop.

* **Landing page** — house theme switcher, animated live standings, weekly bulletin with
  per-house filtering.
* **Display screen** — high-contrast projector UI that short-polls the quiz state every
  500 ms: scores, question, point value, animated countdown, and a
  `BUZZERS OPEN` / `TIME UP` / `ANSWER REVEALED` status chip.
* **Officer panel** — passcode-gated control desk: status buttons, 10/30/60 s timers,
  manual score adjustments, a question bank with CRUD, and a bulletin editor.

**Stack:** raw HTML5 + CSS3 + vanilla ES6 JavaScript, plus two Cloudflare Pages Functions
backed by a Cloudflare KV namespace (`QUIZ_STORE`). No frameworks, no bundler, no build
step — deploy the `public/` folder straight to Cloudflare Pages.

```bash
cd ste-quizball
npm install && npm run dev      # → http://localhost:8788  (passcode: STE_OFFICER_2026)
```

Full setup, deployment and API documentation: **[ste-quizball/README.md](./ste-quizball/README.md)**
