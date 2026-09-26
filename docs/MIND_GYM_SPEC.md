# Mind Gym for Focus Point: Build Spec for Claude Code

> **How to use this file:** put it at `docs/MIND_GYM_SPEC.md` in the Focus-purpose repo, open Claude Code in the repo root, and say:
> *"Read docs/MIND_GYM_SPEC.md and the whole codebase. Use plan mode. Start with Phase 0 and stop for my review after each phase."*

---

## 0. Context and intent

Focus Point (this repo) is a Windows Electron app that enforces rest breaks: overlays on every monitor, breathing guide, eye exercises, synthesized ambience, strict mode, break zones, fullscreen-game detection, weekly stats, tray controls, themes, and auto-updates via GitHub Releases.

I use AI constantly and want to keep my own brain sharp. I want a **brain-training and curiosity module** called **Mind Gym** added to this app. It should offer:

1. A **huge variety** of puzzles, games, and question sets, many generated locally and randomly, others pulled live from free public APIs and websites.
2. A **big searchable keyword bank** of topics. I search or roll a random keyword, and the app builds a learning session around it: summary, quiz, related puzzles, and documentaries or videos to watch.
3. **Anti-AI-dependence exercises**: explain-it-back, predict-then-verify, no-hint thinking timers, and retrieval of what I learned yesterday.
4. **Adaptive difficulty, spaced repetition, and stats** that plug into the existing stats system.

**This is a module inside the existing app, not a separate app.** Reuse the tray, settings store, stats, themes, updater, and IPC patterns already in the codebase.

### Non-negotiables
- **Do not break or change existing Focus Point behavior.** Timer, breaks, strict mode, zones, fullscreen detection, stats, audio, and updater must all work exactly as before. Existing tests in `test/` must still pass.
- **Match existing conventions**: same file layout style (`src/main/*`, `src/renderer/*`), same code style, same settings persistence (`src/main/store.js`), same theming (Night, Dusk, Forest, Sand). Read the code first and follow what's there. Don't introduce a framework (React, etc.) unless the existing renderer already uses one. If it's vanilla JS, stay vanilla (web components are fine).
- **Everything works offline** with a local fallback. Online sources enrich; they are never required.
- **Respect every source's terms of service.** Use official APIs, not scraping, wherever one exists. Show attribution and licenses in the UI. Verify each endpoint, its rate limits, and its current terms **before** implementing it, because the APIs listed below may have changed. If one is dead or its terms forbid this use, skip it and tell me.

---

## 1. Where it lives (architecture)

### New files (suggested; adapt to repo conventions)
```
src/main/brain/
  index.js            # registers IPC handlers, owns the Mind Gym window
  keywords.js         # keyword bank loading, search (fuzzy), random pick, related topics
  providers/          # one file per online content source (see §3)
    provider.js       # common interface + cache + rate limiter + allowlist
    wikipedia.js  wikidata.js  opentdb.js  triviaapi.js  lichess.js
    restcountries.js  met.js  artic.js  inaturalist.js  nasa.js
    dictionary.js  datamuse.js  youtube-rss.js  archive.js
  generators/         # local, offline, random content generators (see §4)
  srs.js              # spaced repetition (FSRS)
  rating.js           # per-skill adaptive difficulty (Elo/Glicko-style)
  brain-stats.js      # extends stats.json / or brain-stats.json
  cache.js            # disk cache under %APPDATA%/Focus Point/brain-cache/
src/renderer/brain.html / brain.js / brain.css
src/renderer/brain/games/<one file or folder per game>
assets/brain/keywords.json   # the keyword bank (see §2)
assets/brain/packs/          # offline question and puzzle packs
test/brain/*.test.js
```

### Main vs renderer rules
- **All network requests happen in the main process** through IPC, behind a **domain allowlist** (only the providers in §3). The renderer never calls `fetch` to arbitrary hosts.
- Set a strict **Content-Security-Policy** on the Mind Gym window. Sanitize any HTML from external sources (e.g. Wikipedia extracts) before rendering.
- **External links open in the default browser** (`shell.openExternal`), not inside the app.
- Embedded videos, if implemented, use `youtube-nocookie.com` embeds in a sandboxed context. The default is "open in browser" plus "add to watch-later queue".
- API keys (optional: YouTube Data API, NASA, Anthropic) are stored with Electron `safeStorage`, never in plain `settings.json`.

### Entry points
- **Tray menu**: new item "Mind Gym" opens the window. Also add "Daily Mix (10 min)" as a shortcut.
- **Settings**: new "Mind Gym" tab (providers on/off, API keys, session length, difficulty, language, break integration).
- **Global hotkey** (optional, configurable, off by default).

---

## 2. The keyword bank (core of the curiosity engine)

Ship `assets/brain/keywords.json` with **at least 1,500 keywords** (target 3,000) across these domains, generated by you (Claude Code) and reviewed for accuracy:

Physics · Chemistry · Biology · Neuroscience · Medicine · Astronomy and space · Earth science and climate · Mathematics · Computer science · Engineering · History (ancient, medieval, modern, 20th century) · Geography and cultures · Economics and finance · Philosophy · Psychology and cognitive biases · Logic and fallacies · Linguistics and etymology · Literature · Art history · Music theory and history · Architecture · Film · Technology history · Inventions · Military strategy · Law and political systems · Religion and mythology · Nature and animals · Food science · Sports science · Latin America and Costa Rica · Famous unsolved problems · Mysteries and anomalies.

Each entry:
```json
{
  "id": "entropy",
  "term": "Entropy",
  "aliases": ["second law of thermodynamics"],
  "domain": "physics",
  "tags": ["thermodynamics", "information theory"],
  "difficulty": 3,
  "related": ["heat-death-of-the-universe", "information-theory", "maxwells-demon"],
  "wikipedia": "Entropy",
  "wikidata": "Q48235"
}
```

### Keyword features
- **Fuzzy search** (e.g. Fuse.js or a small trigram index) with aliases, tag filters, and domain filters.
- **Random keyword**: fully random, random within a domain, "surprise me outside my comfort zone" (weights domains I've touched least), and "rabbit hole" (walk the `related` graph).
- **Keyword of the Day**: deterministic per date, so it's stable all day.
- **User-added keywords**: I can add my own. The app auto-fills summary and related links from Wikipedia and Wikidata if online.
- **Expansion**: an optional button that pulls related topics from Wikipedia links or Wikidata and suggests new keywords for me to accept.
- **Curiosity map**: a visual graph of keywords I've explored, with edges from `related`. Nodes grow with mastery.

### A keyword session (what happens when I pick a keyword)
1. **Predict first**: "Before reading, write one sentence about what you think *Entropy* is." (anti-AI-dependence)
2. **Learn**: Wikipedia summary, a key image, and "On this day" or history facts if relevant.
3. **Quiz**: 5–10 questions generated from Wikipedia and Wikidata facts, trivia APIs filtered by the topic, and (optional) the Claude API.
4. **Puzzle tie-in**: one related puzzle (e.g. physics → estimation/Fermi problem; history → put events in chronological order).
5. **Explain it back**: I write a 3–5 sentence explanation without looking. It's compared to the summary (keyword overlap locally, or graded by Claude if a key is set).
6. **Watch**: 1–3 documentary or video suggestions (see §3, Watch and learn), with an "add to watch-later" option.
7. **Remember**: key facts become spaced-repetition cards.

---

## 3. Online content providers (verify each before using)

Implement a common `Provider` interface: `id`, `name`, `license/attribution`, `isAvailable()`, `fetch(params)`, a per-provider **rate limiter**, a **disk cache with TTL**, and a **graceful offline fallback**. Send a descriptive `User-Agent` (Wikimedia requires this). Each provider can be toggled in Settings.

| Provider | Use in Mind Gym | Notes to verify |
|---|---|---|
| **Wikipedia REST API** | Random article, page summary, "On this day" feed, featured article | CC BY-SA, so show attribution. Requires User-Agent |
| **Wikidata SPARQL / API** | Generated questions: capitals, birth and death years, populations, heights, inventors, "higher or lower", chronology ordering | CC0. Keep queries light |
| **Open Trivia DB** | Multiple-choice trivia by category and difficulty; session tokens to avoid repeats | CC BY-SA |
| **The Trivia API** | Second trivia source, tagged questions | Check free-tier limits |
| **Lichess API** | Daily chess puzzle; also bundle a **subset of the Lichess puzzle database** (CC0) offline, bucketed by rating | Don't hammer the API |
| **REST Countries** + `world-atlas` topojson | Flags, capitals, borders, "find the country on the map" | |
| **The Met Collection API** / **Art Institute of Chicago API** | Art quizzes: guess the era, artist, culture, or medium | Use open-access images only |
| **iNaturalist API** | Identify the species from a research-grade photo; include a Costa Rica filter | Respect photo licenses; show credit |
| **NASA APOD API** | "What am I looking at?" space image quiz + explanation | `DEMO_KEY` is rate-limited; optional user key |
| **Free Dictionary API** (dictionaryapi.dev) | Definitions, word of the day, vocab cards | |
| **Datamuse API** | Word games: rhymes, related words, "means like", clue generation | |
| **YouTube channel RSS feeds** (no key) | Latest videos from curated educational channels (below) | `youtube.com/feeds/videos.xml?channel_id=…` |
| **YouTube Data API v3** (optional key) | Keyword-based documentary search | Quota-limited; off unless a key is set |
| **Internet Archive** | Public-domain documentaries and educational films | Check each item's license |
| **Anthropic API** (optional key) | Generate riddles and questions on any keyword, grade explain-it-back answers, Socratic follow-ups | Off by default; the app must fully work without it |

**Link-out only (no scraping, open in browser):** Project Euler, Advent of Code (past years), Brilliant, Khan Academy, MIT OpenCourseWare, 3Blue1Brown lessons, Lichess studies.

### Watch and learn: curated channel list (seed; I can edit it in Settings)
Veritasium, Kurzgesagt, 3Blue1Brown, Vsauce, PBS Space Time, PBS Eons, Numberphile, Computerphile, Stand-up Maths, Real Engineering, Wendover Productions, Smarter Every Day, Mark Rober, Primer, TED-Ed, SciShow, CGP Grey, Tom Scott, Kings and Generals, Oversimplified, Historia Civilis, Extra History, Crash Course, Closer To Truth, DW Documentary, Free Documentary, BBC Earth, Nat Geo, Up and Atom, Sabine Hossenfelder, Dr. Becky, Steve Mould, Practical Engineering, Branch Education, Asianometry, Lemmino, Company Man, Philosophy Tube, Wisecrack, Great Art Explained, Vox, Johnny Harris, Tibees. **Verify every channel ID.** Tag each channel with domains so videos map to keywords.

**Video flow:** suggest → I watch in the browser → I come back and mark it watched → **3 recall questions** (generated from the title and description plus the keyword's Wikipedia summary, or by Claude if a key is set) → the video becomes a card in "Things I've learned". A watch-later queue lives in the Mind Gym window.

---

## 4. The game catalog (local, random, offline-first)

Every game must declare: `id`, `name`, `skills` (logic, math, language, memory, attention, spatial, strategy, knowledge, deep-thinking), `durationRange`, `difficultyRange`, `offline: true/false`, and implement `start(difficulty, seed)`, `onFinish → {score, accuracy, timeMs, difficulty}`. **Seeded RNG everywhere**, so any puzzle can be replayed or shared by seed.

### A. Logic and reasoning
- **Simon Tatham's Portable Puzzle Collection** (MIT licensed, has a JS/WebAssembly build): integrate as many as practical, including Solo (sudoku variants), Keen (KenKen), Towers, Unequal (Futoshiki), Pattern (nonogram), Loopy (slitherlink), Light Up, Bridges, Net, Tents, Range, Galaxies, Magnets, Signpost, Dominosa, Filling, Palisade, Undead, Mines (no-guess mode), Pearl, Tracks, Unruly, Map, Mosaic. This alone gives 25+ puzzle types with infinite generated instances. Keep the license notice.
- **Logic grid puzzles (zebra/Einstein)**: a generator that guarantees a unique solution.
- **Knights and knaves**: generated truth-teller/liar puzzles.
- **Mastermind / code breaker**, **Tower of Hanoi** (move-count challenge), **syllogism validity**, **spot the logical fallacy** (bank of 40+ fallacies with examples).

### B. Math and numeracy
- **Mental math sprints** (adaptive operations, no calculator; the timer starts on first keypress).
- **Countdown numbers game** and **24 game** (with a solver that proves solvability).
- **Fermi estimation** ("How many piano tuners in San José?"), scored on log-error.
- **Sequence completion**, **Kakuro**, **probability intuition** (Monty Hall, birthday paradox, Bayes: predict, then simulate the answer live).
- **Number sense**: "Which is bigger?" with orders of magnitude (from Wikidata).

### C. Language
- **Countdown letters**, **anagrams**, **word ladder**, **Wordle-style** (own word lists, English and Spanish), **cryptograms** (public-domain quotes only), **mini crosswords** (generated from dictionary and Datamuse clues), **etymology quiz**, **vocabulary SRS**.

### D. Memory
- **Dual n-back** (adaptive), **digit span** (forward and backward), **Corsi block**, **card pairs**, **Kim's game** (images from Met/iNaturalist, recall what disappeared), **memory palace trainer** (method-of-loci walkthrough), **"yesterday" recall** (questions from content I saw 1, 3, and 7 days ago).

### E. Attention and speed
- **Stroop**, **Schulte tables**, **Flanker task**, **Go/No-Go**, **reaction time**, **visual search**, **RSVP speed-reading** with comprehension check.

### F. Spatial
- **3D mental rotation** (Shepard–Metzler cubes with three.js), **tangrams**, **15-puzzle**, **Rush Hour-style sliding blocks** (generated, solvable), **pipe connect**, **map geography** (click the country or city).

### G. Strategy
- **Chess puzzles** (Lichess daily + bundled CC0 subset, rated), **play vs Stockfish (WASM)** at adjustable strength, **Go life-and-death problems** (only if a clearly licensed dataset exists), **Connect Four vs minimax**, **Nim** (with a "discover the winning strategy" mode).

### H. Knowledge
- **Trivia** (OpenTDB + The Trivia API + offline packs), **Wikipedia "guess the article"** (redacted summary), **"On this day" chronology** (order 5 events), **Wikidata higher/lower**, **art era guess**, **species ID** (Costa Rica filter), **APOD "what is this?"**, **flags and capitals**.

### I. Deep thinking (anti-AI-dependence)
- **Explain it back** (Feynman technique), **predict → verify**, **steelman**: write the strongest version of the opposing argument, **first-principles breakdown**: split a problem into assumptions, **"no-AI challenge of the day"**: a small real-world task to do by hand (write a function without autocomplete, calculate a tip mentally, navigate without GPS, write a paragraph from memory), **Socratic mode** (optional Claude key): the AI only asks questions and never gives answers.
- **Thinking timer**: hints and "reveal" stay locked for the first N seconds of any puzzle (configurable).

### J. Riddles and lateral thinking
- An original and public-domain riddle bank (200+), lateral-thinking "situation puzzles", rebus puzzles. Claude-generated riddles on any keyword if a key is set.

**Minimum at launch: 60+ distinct game or question types**, counting each Tatham puzzle separately.

---

## 5. Sessions, randomness, and adaptivity

- **Daily Mix (default ~10 min)**: 1 speed warm-up → 1 logic → 1 memory → 1 knowledge item from the Keyword of the Day → 1 deep-think prompt → 1 video suggestion. Randomized with weights: **favor weaker skills**, **avoid games played in the last 3 days**, and **ensure domain variety**.
- **Modes**: Daily Mix · Random Anything · Pick a Skill · Pick a Keyword · Rabbit Hole · Marathon · Custom playlist.
- **Adaptive difficulty**: a per-skill rating (Elo or Glicko-style) and per-game difficulty targeting about 70–80% success.
- **Spaced repetition**: use FSRS (e.g. the `ts-fsrs` package) for facts, vocab, and video-recall cards. Show a daily review queue.
- **Streaks** with a rest-day allowance, so they don't turn into compulsion.

---

## 6. Integration with breaks (careful: breaks must stay restful)

- New break option in Settings, "Mind spark (long breaks only)". **Off by default.** When enabled, a long break may start with a **≤60-second** gentle challenge (one riddle, one mental math question, or one recall card), then proceeds to breathing and eye rest as usual. Short breaks never show challenges.
- **Eye-exercise breaks never get a screen challenge.**
- **Documentaries are never played during breaks.** A break may show one suggestion card ("Tonight: *X*, 18 min") with an "add to watch-later" button.
- **Mind Gym time counts as screen time.** The break timer keeps running while Mind Gym is open. The fullscreen-detection logic must **not** treat the Mind Gym window as a game or video that postpones breaks.
- Strict mode rules stay exactly the same. Mind Gym must not offer any way around a strict-mode break.
- Break zones also suppress Mind Gym notifications.

---

## 7. Stats

Extend the existing weekly stats view (don't replace it) with a **Mind Gym** section:
- Minutes trained per day, sessions, games played.
- **Skill radar** (logic, math, language, memory, attention, spatial, strategy, knowledge, deep-thinking) over time.
- Keywords explored, curiosity-map growth, SRS cards due/learned, videos watched and recalled.
- Personal bests per game; accuracy and speed trends.
- **"Thinking without AI" minutes**: time spent in deep-thinking exercises.
- Everything stays local (same privacy promise as the current stats). Add export to JSON/CSV.

---

## 8. Settings (new "Mind Gym" tab)

Session length · difficulty bias · language (English/Spanish/both for word games) · which skills and domains to include · provider toggles · API keys (safeStorage) · curated channel list editor · thinking-timer seconds · break integration toggle · notification for "Keyword of the Day" (off by default) · reset stats · clear cache · attributions and licenses page.

---

## 9. Quality, testing, and performance

- Unit tests (same runner as `npm test`) for: seeded RNG determinism, every generator's **solvability and uniqueness** (logic grids, numbers game, sliding blocks, sudoku), Elo/FSRS updates, keyword search, provider caching, and offline fallback (mock network off).
- `npm run dev` fast mode must still work, and Mind Gym should respect it where time-based.
- Lazy-load games; the Mind Gym window must open fast. Keep installer size growth reasonable; download heavy assets (big puzzle DB subsets, Stockfish WASM) on first use with progress and a cache.
- Keyboard-first controls, accessible contrast in all four themes, and colorblind-safe palettes (Stroop needs care here).
- Update the README: a new "Mind Gym" feature section and "How it's built" table rows.

---

## 10. Phases (stop for my review after each)

- **Phase 0 (plan only):** Read the entire repo. Summarize the architecture back to me, list exactly which existing files you'll touch and why, flag risks to existing features, and verify the providers in §3 (still alive? terms allow this?). No code yet.
- **Phase 1 (skeleton):** Mind Gym window, tray entry, settings tab, keyword bank (first 500 keywords) with search/random, game interface, 5 local games (mental math, Stroop, n-back, Schulte, word ladder), stats plumbing, tests.
- **Phase 2 (online content):** provider framework, cache, allowlist, then Wikipedia, Wikidata, OpenTDB, REST Countries, Lichess daily, and the full keyword session flow (§2).
- **Phase 3 (variety):** Tatham puzzle integration and the rest of §4 to reach 60+ types. Keyword bank to 1,500+.
- **Phase 4 (watch and learn):** YouTube RSS, watch-later queue, video recall quizzes, Internet Archive, art/nature/space providers.
- **Phase 5 (adaptivity):** Daily Mix weighting, skill ratings, FSRS, curiosity map, stats section.
- **Phase 6 (breaks + optional AI):** Mind-spark integration per §6, optional Claude features, final polish, README, version bump.

At the end of each phase: run all tests, run the app in dev mode, confirm existing break behavior is unchanged, and give me a short changelog plus anything you skipped and why.
