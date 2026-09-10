# yskeys

A static typing trainer that records per-character and per-n-gram accuracy, then generates
the next drill from your own weak spots. No backend. Data lives in `localStorage` and can be
exported to / reloaded from a local JSON file.

Repo: `yskeys` · Deploy: GitHub Pages (`https://<user>.github.io/yskeys/`) · UI language: English (hardcoded)

---

## 1. Goal

Make weak-key practice **automatic** instead of manual.

1. Open the page, type immediately — no account, no network, no setup.
2. After training, see exactly which characters, character pairs, and fingers you miss.
3. Drill those units more often than the ones you already know.
4. Take the data with you: export JSON, import it anywhere, and the profile continues.

Explicitly **not** a typing game, course, or race leaderboard.

## 2. Users

People who already touch-type and want to get faster and more accurate — in practice, people
who also want to drill uppercase, digits, and programming symbols (`{}[]()<>=+-_|;:'"`).

Must work: physical keyboard, desktop browser, offline after first load.
Must not break: touch devices (show "use a physical keyboard" notice instead of silently failing).

## 3. Features

Each feature lists **Trigger** (when it fires), **Normal** (expected outcome), **Exceptions**
(what can go wrong and what the app does).

### F1 — Session generation
- **Trigger**: page load with no active session, or "Again" after a result, or `Esc`.
- **Normal**: build the whole session up front (default ≈ 150 non-space characters) from the enabled
  charsets, in one of two shapes: **words** drawn from the list the user imported, or **uniform
  character groups**. Words are used when the shape setting asks for it, a list is imported, and every
  enabled charset is a letter set; otherwise the character drill runs. Weights come from history; with
  no history, use the cold-start prior. Show the target with the current position highlighted.
- **Exceptions**: only one charset enabled → fine. Zero charsets enabled → block start and prompt
  to enable one. History exists but every unit has 0 attempts → fall back to cold-start prior.

### F2 — Keystroke capture and judging
- **Trigger**: `keydown` while the practice view is focused.
- **Normal**: accept keys where `event.key.length === 1`; compare to `target[i]`. Correct → advance
  and mark correct. Wrong → advance anyway, mark red, record the miss against the **first** attempt
  at that position. `Backspace` corrects the display only; it never creates a new sample. The space
  between groups is an ordinary character here: judged, counted and recorded like any other key.
- **Exceptions**: `Esc` aborts/restarts; `Enter` starts the next session from the result view.
  `Tab` and `Shift+Tab` are **never intercepted** (keyboard navigation must always work). Unknown or
  modifier keys and IME composition are ignored, not counted. Window blur → pause timer and hide the target.
  `keydown` bursts faster than render → stats still computed per event, never per animation frame.

### F3 — Live stats and session result
- **Trigger**: continuously during typing; fully rendered when position reaches the end.
- **Normal**: show live accuracy, CPM, elapsed time, error count. On finish show first-try accuracy,
  CPM, WPM, duration, backspaces, and the 5 weakest units of that session (with sample counts).
- **Exceptions**: session abandoned mid-way (`Esc`/reload) → not persisted as a session; the
  keystrokes already made are discarded rather than half-counted. Duration excludes paused time
  **and** any gap longer than `IDLE_GAP_MS` (1.5 s): stepping away must not wreck the session's CPM.

### F4 — Local persistence
- **Trigger**: session end (and after import / clear).
- **Normal**: merge the session delta into `Aggregates` — unigrams, bigrams, trigrams, and the
  per-finger, per-hand, per-Shift and per-character-kind counters — and write to `localStorage` under
  one versioned key, together with the settings. The imported word list is stored under its own key,
  so history pruning and "clear all data" can never touch it. Keep the last 200 session summaries.
- **Exceptions**: `localStorage` unavailable or quota exceeded → app keeps working in memory, shows a
  persistent banner ("history is not being saved — export your data"), never throws. An unreadable
  payload is parked under a `yskeys:corrupt:` key instead of being overwritten. Payload over
  `MAX_PAYLOAD_CHARS` (2,000,000 UTF-16 code units, the unit browsers count against the ~5 MB quota)
  → prune the lowest-`attempts` trigrams first, then bigrams, and prompt an export.

### F5 — Adaptive weighting
- **Trigger**: every session build (default mode `adaptive`).
- **Normal**: `w(s) = max((1 - acc_smoothed(s))^2 × boost, 0.05)`, `boost = 2.5` when a unit has
  fewer than 10 attempts. Sample 60% from the weakest 30% of units, 25% from the next tier, 15%
  uniformly at random (anti-forgetting). No unit twice in a row.
- **Exceptions**: no history → cold-start prior (home row → top row → bottom row → digits → shifted
  → symbols). All units equally bad → degenerates to near-uniform, which is acceptable. `uniform`
  mode is available as an A/B control and must stay working.

### F6 — Accuracy definitions
- **Trigger**: weighting (M3). The history tables deliberately show **raw** accuracy instead.
- **Normal**: the stored record is a raw count. Weighting uses
  `acc_smoothed = (firstTryCorrect + 5×0.9) / (attempts + 5)` — a Beta prior so one attempt cannot
  produce 0% or 100%. An n-gram's first try counts as correct only if **every** position in it was
  correct on its first attempt.
- **Exceptions**: `n < 10` → flagged "low sample" in the history tables, which always print the
  sample size next to the number. Smoothing is kept out of those tables on purpose: showing a 0-of-1
  key as 75% would misrepresent what actually happened. Bigram accuracy is dominated by its two
  characters; `lift = acc2 / (acc1(x)·acc1(y))` is **recorded from day one**
  and only used for weighting in v1.1 (so no data migration is needed later).

### F7 — History and weak-spot view
- **Trigger**: user opens History.
- **Normal**: totals, CPM trend (inline SVG, no chart library), and sortable weak-spot tables for
  single chars, bigrams, symbols, and fingers — sortable by accuracy / error count / sample size.
- **Exceptions**: no data → empty state with a "start a session" link. Very long history → tables
  paginate or cap at top 15 per table.

### F8 — Export
- **Trigger**: "Export" in History.
- **Normal**: download `yskeys-export-YYYYMMDD-HHmm.json` (2-space indented) containing
  `kind`, `schemaVersion`, `exportedAt`, `app.version`, `settings`, `aggregates`, `sessions`, and the
  imported word list when there is one.
- **Exceptions**: download blocked → offer a copy-to-clipboard textarea fallback.

### F9 — Import
- **Trigger**: user picks a JSON file and chooses **Replace** or **Merge**.
- **Normal**: Replace overwrites local data after snapshotting the current state to a one-step
  undo backup. Merge adds counters field-by-field, unions sessions by `id`, keeps the earlier
  `createdAt`. **Both modes adopt the settings from the file**, so the two modes differ only in how
  the numbers combine and the file is the single source of truth for what is being practised. A file
  that carries a word list replaces the local one; a file without one leaves the local list untouched.
- **Exceptions**: malformed JSON / wrong `kind` → reject, keep current data, show the reason.
  `schemaVersion` newer than the app → refuse and ask the user to update the page. Older → run the
  migration chain. Merge with a file whose `schemaVersion` is older → migrate first, then merge.

### F10 — Settings
- **Trigger**: charset / length / mode controls in the header.
- **Normal**: charsets = lowercase (default on), uppercase, digits, punctuation, programming symbols.
  Length 15 / 30 (default) / 60 groups. Shape `words` (default) / `characters`; the words option is
  disabled with a stated reason when no usable list is loaded, when the list has too few usable words,
  or when a non-letter charset is enabled. Mode `adaptive` (default) / `uniform`; that control arrives
  with M3. Changes apply to the **next** session, never mid-session.
- **Exceptions**: turning off all charsets is prevented at the UI level. Settings persist alongside
  history and are included in the export.

### F11 — Clear data
- **Trigger**: "Clear all data" + typed confirmation.
- **Normal**: delete the history store and settings, reset to cold start. The imported word list
  survives on purpose: it is a file the user had to download, not history they can regenerate.
- **Exceptions**: none — the confirmation is the guard. Undo is not offered here (export instead).

### F12 — Keyboard heatmap *(cuttable)*
- **Trigger**: History view toggle.
- **Normal**: US QWERTY layout colored by single-char accuracy, with a legend and sample counts.
- **Exceptions**: no data → neutral layout with a hint. Keys never practiced → distinct "no data"
  color rather than "0%".

## 4. Not doing (MVP non-goals)

| Not doing | Why |
| --- | --- |
| Chinese / pinyin / IME input | Composition state breaks keystroke attribution; different metric entirely |
| Article / passage mode | Words are drilled, but only from a word list — no sentences or prose |
| Bundling a word list in the repo | No third-party data ships here: you import a file you downloaded yourself, so no licence obligation attaches to the repository |
| Pasting custom text to type | Same — v1.1 |
| Accounts, cloud sync, leaderboards, sharing | No backend is an architectural premise |
| Spaced repetition (SRS / Anki-style scheduling) | v2; MVP uses weighted sampling only |
| Multiple keyboard layouts (Dvorak/Colemak) | US QWERTY for display and finger attribution only |
| Touch / mobile virtual keyboard | Physical keyboard only |
| "Must fix the error to continue" mode | Decided: allow errors, judge per position |
| Sound, user-selectable themes, decorative animation | Not worth the budget. Dark mode follows the OS via `prefers-color-scheme` only — no switcher |
| PWA / service worker, SSR | Plain static site |
| i18n / language switcher | UI is hardcoded English |

Cut order if time runs short: F12 → latency median → per-finger stats → trigram stats. Down to that
point it is still "an adaptive single-char + bigram trainer", which is the core value.

## 5. Tech choices

| Area | Choice |
| --- | --- |
| Build | Vite + TypeScript (`strict`), `base: '/yskeys/'` (injected as `--base=/yskeys/` in CI) |
| Tests | Vitest; all of `core/` and `store/` are pure functions, coverage ≥ 80% |
| Runtime deps | **Zero** — no framework, no chart library (inline SVG), no fonts, no CDN, no analytics |
| Storage | `localStorage`, one versioned key, aggregate counters + last 200 session summaries |
| Deploy | GitHub Actions: `main` → install → test → build → `actions/deploy-pages`; no secrets |
| Local dev | `pnpm dev` / `pnpm build` / `pnpm test` |

### Data model

The authoritative shapes live in `src/store/schema.ts`; this is only the summary.

- One `localStorage` key (`yskeys:v1:store`) holds `{ schemaVersion, settings, aggregates, sessions }`.
  Undo backups and parked unreadable payloads use separate key prefixes.
- Recorded dimensions: `unigrams`, `bigrams`, `trigrams`, `byFinger`, `byHand`, `byShifted`, `byKind`.
  Every dimension counts first-try attempts only, and keeps a per-unit confusion map of what was
  actually typed.
- **Groups are separated by a real space character, which is a target.** It is typed like any other
  key, recorded as a unigram, and attributed to `byFinger['thumb']` and `byKind['space']`. A drill of
  30 groups therefore has 179 characters, not 150. Space is deliberately **not** one of the five
  selectable charsets: it is never optional, it is the separator.
- The **imported word list** lives under its own key (`yskeys:v1:words`), outside the history store:
  the budget guard must never prune it and "clear all data" must never delete a file you had to
  download. An export carries it; an import that has one replaces it, and one that does not leaves it
  alone. Parsing is deliberately permissive (dice numbers, comments, CRLF, any printable ASCII) and
  reports how many lines it skipped; usability is decided per session, because the enabled charsets can
  change after the import. There is no bundled list.
- Trigrams are all accumulated and persisted; ones below three attempts are only hidden from the UI.
  The earlier "persist only ≥ 3 attempts" rule was dropped because it reset sub-threshold counts on
  every write, so a trigram seen once per session could never accumulate.
- An export file is `{ kind, schemaVersion, exportedAt, app, settings, aggregates, sessions }`.

Layout:

```
yskeys/
├─ PROJECT.md · DESIGN.md · README.md
├─ index.html
├─ package.json · tsconfig.json · vite.config.ts · pnpm-workspace.yaml
├─ public/favicon.svg
├─ .github/workflows/deploy.yml
└─ src/
   ├─ main.ts          # wiring: views, keyboard, session lifecycle
   ├─ config.ts        # all tunables (γ, α, boost, mix ratios, lengths, size guard)
   ├─ vite-env.d.ts    # Vite ambient types (asset imports)
   ├─ core/            # pure, no DOM: charset, random, generator, wordlist, engine, metrics, layout (+ adaptive)
   ├─ store/           # schema (+validators), migrations, aggregate, persistence, transfer, wordlist
   ├─ ui/              # dom, format, stat, banner, chart, dialogs, settings-controls,
   │                   # typing-view, result-view, history-view, styles.css
   └─ test/            # invariant tests for core/ and store/
```

Data flow: `charset + aggregates → adaptive.weights → generator.buildSession → engine → SessionSummary + MetricDelta → aggregate.merge → persistence.save → result/history views`.

## 6. MVP done when

1. `pnpm build` deploys to the Pages subpath; refreshing any deep link does not 404.
2. Zero third-party network requests in the built artifact (verified in the Network panel).
3. After a 30-group session, `attempts` / `firstTryCorrect` deltas exactly match the keystrokes.
4. Export → clear → import (Replace) round-trips to an identical store, field by field.
5. Importing the same file twice in Merge mode exactly doubles counters and does not duplicate sessions.
6. Given `a` at 50% and `b` at 99% (100 samples each), 1000 samples put `a` ≥ 5× more often than `b`;
   and a 100%-accuracy unit still appears over a long session (weight floor works).
7. History survives reload; broken/blocked `localStorage` degrades gracefully with a banner.
8. `pnpm test` green, no console errors, and §4 non-goals are genuinely absent.

## 7. Later

**v1.1** — `lift`-weighted bigrams, trigram generation, code-shaped tokens for the symbol and digit
charsets (the current answer for those is still random groups), paste-your-own text, goals/streaks.
**v2** — move to IndexedDB with a raw keystroke event log, SRS scheduling, multiple layouts,
File System Access API auto-save to a local folder, multiple named word lists.

Rejected outright: generated pronounceable pseudo-words. A word list the user chooses is better
practice material and needs no invented data.
