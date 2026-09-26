# Mind Gym — Phase 0 report (plan only, no code)

Status: **awaiting review.** Written against `main` at v1.5.0 (`c7427c0`).
Spec: [`MIND_GYM_SPEC.md`](MIND_GYM_SPEC.md).

---

## 1. The app today (architecture summary)

Focus Point is plain Electron + vanilla JS. There's no bundler and no framework. Renderer pages load classic `<script>` tags, and all Node access goes through one `contextBridge` preload.

| Layer | File | What it does |
|---|---|---|
| Boot / wiring | `src/main/main.js` | Single-instance lock; creates the store, timers, stats and updater; owns every window (settings, break overlays, stand overlays, stand widget) and the tray; registers all IPC. |
| Break rhythm | `src/main/timer.js` | `RestTimer`: pure logic, with phases `working / break / waiting / paused / away / deferred`. It holds breaks for the reasons `standing`, `zone` and `fullscreen`. The clock is injected, so it's fully unit-tested. |
| Stand rhythm | `src/main/stand.js` | `StandTimer` (pure): `sitting → raise → exercise → standing → lower`. While it's active, breaks are held. |
| Zones | `src/main/zones.js` | `activeZone(zones, now)`, pure. |
| Fullscreen | `src/main/fullscreen.js` | Win32 via koffi. **It already ignores windows owned by our own process** (`process.pid` check). |
| Strict mode | `src/main/keyblock.js` | A `WH_KEYBOARD_LL` hook, active only while break overlays are up. |
| Settings | `src/main/store.js` | A JSON file in `%APPDATA%/Focus Point`. `set()` does a **shallow** merge; only `mix` is deep-merged. |
| Stats | `src/main/stats.js` | Per-day totals in `stats.json`: rest, work (screen time), breaks, stands. It listens to timer events. |
| Updates | `src/main/updater.js` | electron-updater against GitHub Releases. The CI publishes a release automatically when `main` gets a new version. |
| Bridge | `src/preload.js` | A single `window.api` exposed to **every** window. |
| UI | `src/renderer/*.html/js/css` | `settings` (6 tabs: Rhythm, Break, Stand, Sound, Stats, General), `break`, `stand`, `widget`, `stats-view`, `zones-view`, `audio/engine.js` (Web Audio). Themes are CSS variables in `theme.css`. |
| Tests | `test/*.test.js` | Run with `node --test`; 27 tests covering the timer, stand, stats, zones and keyblock logic. |
| Packaging | `package.json` `build` | NSIS for Windows. The `files` setting includes `src/**` and `assets/**`. koffi is unpacked from the asar archive. |

---

## 2. How Mind Gym plugs in (proposed design)

**Principle:** Mind Gym is a *guest*. It gets its own window, preload, IPC namespace, store key and stats file. Existing code only gains small, additive hooks.

```
main.js ──(3 small hooks)──▶ src/main/brain/index.js   ← owns everything below
                               ├─ window (brain.html) + its own preload (brain-preload.js)
                               ├─ keywords.js (search / random / daily / related graph)
                               ├─ games registry metadata, sessions, rating.js, srs.js
                               ├─ providers/* → net layer (allowlist + limiter + cache)
                               ├─ brain-stats.js → brain-stats.json
                               └─ secrets.js (safeStorage for API keys)
renderer: brain.html → brain.js (shell/router) → brain/games/<id>.js (lazy <script> injection)
```

Key decisions:

1. **A separate preload for the Mind Gym window** (`src/brain-preload.js`, exposing `window.gym`). Existing windows keep `window.api` unchanged, and the Mind Gym window only gets the brain API plus the read-only theme and settings it needs. This keeps the attack surface small, since this is the one window that shows third-party content.
2. **All network traffic goes through one module in main** (`brain/net.js`) using Electron's `net` (the Chromium network stack, which respects system proxies). It has:
   - a hostname allowlist (§5)
   - a per-provider token-bucket rate limiter
   - a descriptive `User-Agent`: `FocusPoint/<ver> (https://github.com/Niick-pixel/Focus-purpose; <contact>)`
   - an on-disk cache with a TTL per provider
   - a timeout
   - an offline fallback to bundled packs

   The renderer never fetches remote hosts. Its CSP will have `connect-src 'none'`.
3. **Images are proxied too.** Main downloads each allowlisted image into the cache, and the renderer loads it through a registered `gym-cache://` protocol. The Mind Gym CSP is then `img-src 'self' data: gym-cache:`. That gives no remote hosts in the renderer, offline replay of past content, and one place to attach credits.
4. **Settings live in the Mind Gym window, not a 7th settings tab.** At 460 px the settings window already fits exactly 6 tabs (I tightened the padding for Stand). I'll add:
   - a **"Mind Gym" row in General** that opens the Mind Gym settings pane
   - the §6 **"Mind spark"** toggle in the **Break** tab, where all the other break options are

   The Mind Gym window gets a gear icon with every §8 setting. *(This deviates from §8; see question Q1.)*
5. **Store:** a single `brain` object in `settings.json`, with a small deep-merge added to `store.set()` for `brain` (the same pattern as `mix`). API keys never go into it. They go into `secrets.json`, encrypted with `safeStorage` (DPAPI on Windows).
6. **Stats:** Mind Gym data goes in its own `brain-stats.json`, covering sessions, per-game results, skill ratings, SRS cards, keywords explored and videos. Minutes trained per day are *also* mirrored into `stats.json` as a new `brainMs` day field, so the existing weekly view can show one extra tile and a "Mind Gym" section. The existing fields stay as they are.
7. **Games:** a game is a self-contained renderer module registered on `window.GymGames`. Each declares `{id, name, skills, durationRange, difficultyRange, offline}` and implements `start(root, {difficulty, seed, onFinish})`. Games load lazily by injecting their `<script>` on first use, which keeps the window fast. Pure logic (generators and solvers) lives in files that work in **both** Node and the browser, so it can be unit-tested with `node --test`: seeded RNG, 24/Countdown solvers, logic-grid uniqueness, sliding-block BFS, and so on.
8. **Keyword search** runs in main, over a prebuilt index (a trigram index I'll write myself, around 100 lines, so no dependency). Fuse.js (Apache-2.0) is the fallback if I hit quality limits.
9. **SRS:** `ts-fsrs` (MIT, CommonJS build) runs in main.
10. **Seeded RNG:** mulberry32 plus string hashing. The keyword of the day is `hash(YYYY-MM-DD)`.

---

## 3. Existing files I'll touch, and why

| File | Change | Phase |
|---|---|---|
| `src/main/main.js` | (a) `require('./brain')` and `brain.init({store, stats, timer, stand, broadcast, ...})`. (b) Tray items **Mind Gym** and **Daily Mix (10 min)**. (c) Pass `mindSpark` in the break payload (Phase 6). Nothing else. | 1, 6 |
| `src/main/store.js` | Add a `brain: {…}` defaults block, plus a deep merge for `brain` in `set()`. | 1 |
| `src/main/stats.js` | Add a `brainMs` day field and `recordBrain(ms)`. Existing fields are untouched. | 1 |
| `src/renderer/settings.html/js/css` | General tab: an "Open Mind Gym" row. Break tab: the "Mind spark (long breaks only)" toggle (Phase 6). | 1, 6 |
| `src/renderer/stats-view.js` + `settings.html` | A Mind Gym tile row / section in Stats. | 1, 5 |
| `src/renderer/break.html/js/css` | Phase 6 only: an optional ≤60 s spark card before breathing, on long breaks only, and never during eye-exercise breaks. | 6 |
| `package.json` | Deps: `ts-fsrs` (Phase 5); maybe `fuse.js`. Test glob → `test/**/*.test.js` (Node 22 supports `**`). Build `files` already covers `assets/**`. | 1, 5 |
| `.github/workflows/build-windows.yml` | Phase 3: a job step that builds the Tatham puzzles to WASM with Emscripten (see §6-R3). | 3 |
| `README.md` | Feature section and "How it's built" rows. | each |

**Not touched:** `timer.js`, `stand.js`, `zones.js`, `fullscreen.js`, `keyblock.js`, `updater.js`, `preload.js` (Mind Gym gets its own preload), `audio/engine.js`, `stand*`, `widget*`.

---

## 4. Risks to existing features — and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Fullscreen detection** postponing breaks while Mind Gym is maximised/fullscreen | Already safe: `fullscreen.js` returns false for any window owned by our own PID. I'll add a regression test on the pure part and keep Mind Gym out of `setFullScreen`. |
| 2 | **Strict mode bypass** | Break overlays are `alwaysOnTop('screen-saver')` on every display, and the key hook blocks Alt+Tab. The Mind Gym window will use *normal* z-order, never `alwaysOnTop`. I'll add a check that no Mind Gym IPC can call `timer.skipBreak/snooze/pause`. |
| 3 | **Breaks during a game** | Mind Gym listens to `state`. On `break` it pauses the game clocks (so reaction-time scores aren't polluted) and resumes afterwards. The break still happens normally. |
| 4 | **Idle → "away" while reading** (no input for 5 min resets the work timer) | This is existing behaviour and arguably correct. Mind Gym will *not* fake input. I'll document it. |
| 5 | **Store shallow merge**: a partial `brain` update could wipe sibling keys | Add a `brain` deep merge (like `mix`) and a test for it. |
| 6 | **Preload surface**: third-party text in a window with powerful IPC | Separate preload; sanitise external HTML (Wikipedia gives plain-text `extract`, so I'll use `textContent` only and render no HTML at all); strict CSP; `sandbox: true`; `shell.openExternal` only for `https:` URLs on an allowlist. |
| 7 | **Installer size** (currently ~113 MB) | Keyword bank + packs ≈ 1–3 MB. Heavy items are **downloaded on first use** into the cache: the Lichess subset and Tatham WASM (~2–4 MB total, bundle-able), plus the Stockfish WASM (GPL — see R5). |
| 8 | **Test glob change** hiding existing tests | Switch to `test/**/*.test.js` and verify the count goes from 27 to 27 + new ones. |
| 9 | **Performance** of the tray, timer and break overlays | Mind Gym work is lazy and runs only while its window is open. The network runs in main but is async and rate-limited, so the timer tick is unaffected. |

---

## 5. Provider verification (done 2026-09-26 via current documentation)

This dev container's network policy **blocks all of these hosts**, so I verified terms and status from their current documentation via web search, not live calls. Live behaviour must be confirmed on your machine. I'll build every provider against recorded fixture responses plus an offline fallback, so Phase 2 is testable here.

| Provider | Status | Terms / limits found | Decision |
|---|---|---|---|
| **Wikipedia REST** (`/api/rest_v1/page/summary`, `feed/onthisday`, `page/random/summary`) | Alive. **RESTBase is being sunset behind an API gateway**; the Core REST API gets gradual deprecation from **July 2026**, with replacements "to be announced". | CC BY-SA; User-Agent required. | ✅ Use, behind an adapter with a fallback to the **Action API** (`action=query&prop=extracts&exintro&explaintext`), which is the stable path. Credit "Wikipedia, CC BY-SA 4.0" with a link. |
| **Wikidata SPARQL** | Alive but **slow in 2026**. Limits: 60 s query time per minute per IP+UA, 5 concurrent queries, 30 errors per minute; bans if 429s are ignored. | CC0; User-Agent required. | ✅ Use sparingly. **Precompute** most fact sets (capitals, populations, dates) into offline packs at build time, and use live queries only for keyword-specific facts, cached for 30 days. |
| **Open Trivia DB** | Alive. | **1 request per 5 s per IP**; session tokens expire after 6 h idle; CC BY-SA 4.0. | ✅ Use, with a 5.5 s limiter and a stored token. Attribution in the UI. |
| **The Trivia API** | Alive. | **CC BY-NC 4.0**: free for *non-commercial* use; commercial use needs a paid key. | ⚠️ OK for a free personal app. **Off by default** with a clear NC notice (Q4). |
| **Lichess API** (`/api/puzzle/daily`) | Alive. | One request at a time; wait **a full minute** after a 429. | ✅ Daily puzzle only, cached 24 h. |
| **Lichess puzzle DB** | Alive. | **CC0**; ~3–5 M puzzles; CSV columns `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`. | ✅ Ship a **curated subset** (~6k puzzles, 12 rating buckets, high popularity ≈ 1 MB). The source file can't be downloaded from this container, so I'll add a script (`scripts/build-lichess-subset.js`) that runs in CI or on your PC (R2). |
| **REST Countries** | Operational. | `/all` **requires `?fields=` (≤10 fields)**, otherwise 400. | ✅ But I'll **snapshot** the ~250 countries into an offline pack, since the data is static, and use the API only to refresh. `world-atlas` (ISC) for maps. |
| **The Met Collection API** | Alive. | CC0 data + public-domain images; **≤80 req/s**; no key. | ✅ Use (`isPublicDomain` only). |
| **Art Institute of Chicago API** | Alive. | 60 req/min anonymous; send `AIC-User-Agent`; data CC0, descriptions CC-BY 4.0. **The IIIF image host sits behind a Cloudflare challenge that 403s non-browser clients.** | ⚠️ Metadata ✅. Images: try Electron `net` (Chromium stack); if blocked, **skip AIC images** and use the Met only (R6). |
| **iNaturalist API** | Alive. | ≤60 req/min recommended (100 hard), ≤10k/day, **≤5 GB media/hour**; photo licenses vary per photo. | ✅ Research-grade observations, **only photos licensed CC0/CC-BY/CC-BY-SA**, with credit shown. Costa Rica = `place_id` filter. |
| **NASA APOD** | ⚠️ **The legacy `api.nasa.gov/planetary/apod` is being archived on 1 Dec 2026**; the new source is `science.nasa.gov/wp-json/wp/v2/apod-basic`. | DEMO_KEY: 30/h, 50/day. | ✅ Implement against the **new WordPress endpoint** from the start, with the legacy endpoint as a fallback until December. |
| **Free Dictionary API** | Alive (health check April 2026). | No key; no stated limits; Wiktionary-derived (CC BY-SA). | ✅ Polite limiter (1 req/s) + cache. Attribute Wiktionary. |
| **Datamuse** | Alive. | Free, non-commercial, ≤100k/day, no key — **a key becomes mandatory on 1 Jan 2027**. | ✅ Use now; add an optional key field so it keeps working in 2027 (or fall back to the offline word lists). |
| **YouTube channel RSS** | Works in 2026. | 15 latest uploads per channel; no key. | ✅ **Channel IDs:** I must verify each of the 43. youtube.com is blocked here, so I'll resolve IDs from reliable sources where possible and add a Settings button that re-resolves any channel by its @handle on your machine (R4). |
| **YouTube Data API v3** | Alive (quota-limited). | Key required. | ✅ Optional; off without a key. |
| **Internet Archive** | Alive. | `advancedsearch.php` is public, no auth; be polite (≈1 req/s). | ✅ Filter by public-domain licence (`licenseurl` / `rights`), e.g. the Prelinger collection; show the licence per item. |
| **Anthropic API** | — | Optional user key. | ✅ Phase 6, off by default. I'll look up current model IDs and API usage when implementing. |
| **Stockfish WASM** | Alive. | **GPL-3.0.** Bundling it would force GPL obligations onto the MIT app. | ⚠️ **Don't bundle.** Download on first use as a separate worker, with source/licence links shown, or skip "play vs Stockfish" and ship **Connect Four + chess puzzles** only (Q3). |
| **Simon Tatham puzzles** | Alive. | **MIT** (upstream + the medmunds web port). Built with Emscripten. | ✅ The build needs Emscripten, which this container can't download (R3). Plan: CI builds the WASM on the GitHub runner. |
| **ts-fsrs** | — | MIT, Node ≥ 20 (Electron 44 ships a newer Node). | ✅ |

Link-outs (Project Euler, Advent of Code, Brilliant, Khan, MIT OCW, 3Blue1Brown, Lichess studies) are plain `shell.openExternal` links, with no requests from the app.

---

## 6. Risks to the plan itself

- **R1 — No live network in this dev environment.** Every provider is written against fixtures and tested offline; the first live run happens on your PC. I'll add a **"Test providers" diagnostics button** in Mind Gym settings that pings each provider and reports status, rate-limit headers and errors, so you can report back quickly.
- **R2 — Lichess subset** can't be generated here → a script plus a CI step. Until then, chess puzzles use a small hand-verified starter set.
- **R3 — Tatham WASM** needs Emscripten → add a CI job (`emscripten/emsdk` action) that builds the ~25 puzzles and attaches them to releases/`assets`. If that fails, Phase 3 still reaches 60+ types without Tatham, using my own generators (sudoku, KenKen, nonogram, futoshiki, slitherlink, etc.), just fewer.
- **R4 — YouTube channel IDs** can't be checked live here → ship the IDs I can confirm, plus handle-based re-resolution.
- **R5 — Stockfish is GPL** → see Q3.
- **R6 — AIC images** may be blocked for non-browser clients → the Met is the primary art source.
- **R7 — Content accuracy.** 1,500–3,000 keywords, 200+ riddles, 40+ fallacies and trivia packs written by me need review. Mitigations:
  - I **won't hand-write Wikidata QIDs** (too easy to get wrong). They're resolved at runtime from the Wikipedia title (`pageprops.wikibase_item`) and cached.
  - Wikipedia titles are checked by a script on your machine or in CI.
  - A "report a wrong fact" button writes to a local review file.
- **R8 — Spanish word lists** for Wordle/anagrams need a clearly licensed source → to be researched in Phase 3. If I don't find a clean licence, I'll generate from CC-licensed Wiktionary frequency lists, or ship English-only first.
- **R9 — Scope.** This is roughly the size of the whole app so far, times three. The phases stay as written, and each ends with tests, a dev-mode run and a break-behaviour regression check.

---

## 7. Questions for you (answer before Phase 1)

- **Q1 — Settings location.** Put Mind Gym settings **inside the Mind Gym window** (gear icon), with an "Open Mind Gym" row in General and "Mind spark" in the Break tab? *(Recommended — a 7th tab doesn't fit the 460 px settings window.)* Or widen the settings window and add a 7th tab?
- **Q2 — Window style.** A normal resizable window (≈1100×760) with the same themes and backdrop as the break screen? *(Recommended.)* Or a single-panel, Apple-style minimal window?
- **Q3 — Stockfish (GPL).** (a) Download on first use as a separate component *(recommended)*, (b) skip it, or (c) make the whole app GPL-3.0?
- **Q4 — The Trivia API (non-commercial licence).** Include it, off by default? *(Recommended.)*
- **Q5 — Language.** Is the UI English-only for now, with Spanish only for word games (per §8)?

---

## 8. Phase 1 — concrete plan (once approved)

1. The `brain` store block with deep merge, and `brainMs` in stats (with tests).
2. `src/main/brain/index.js`:
   - the window (sandboxed, own preload, CSP, `gym-cache://` protocol stub)
   - tray items, the IPC namespace `gym:*`, and pausing on breaks
3. `keywords.js`: the trigram index, fuzzy search, filters, the four random modes, keyword of the day, and the related-graph walk. `assets/brain/keywords.json` gets the **first 500 keywords** across all 33 domains.
4. Game interface and registry, `rng.js` (seeded), a results pipeline into `brain-stats.json` and `stats.json`.
5. **5 games:** mental-math sprint (adaptive, timer starts on the first key), Stroop (colourblind-safe: word/ink pairs chosen from a validated palette plus a shape cue), dual n-back (adaptive), Schulte table, word ladder (BFS-verified solvable, English list).
6. The Mind Gym window UI:
   - home with Keyword of the Day, search and random, a game grid, and a stats strip
   - themed in Night, Dusk, Forest and Sand
   - keyboard-first
7. Settings: the "Open Mind Gym" row, and the Mind Gym settings pane (the basic fields for now).
8. Tests:
   - RNG determinism, keyword search and random modes
   - generator solvability for the word ladder and mental math
   - store deep merge, stats `brainMs`
   - a check that the break/strict/fullscreen paths are unaffected
9. Run everything: all tests, a dev-mode app run with screenshots, and the break/stand/zone/strict regression scripts. Then stop for your review.
