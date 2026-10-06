# yskeys

A static typing trainer that records per-character accuracy and which finger owns each key,
then generates the next drill from your own weak spots. No backend. Data lives in
`localStorage` and can be exported to / reloaded from a local JSON file.

Repo: `yskeys` · Deploy: GitHub Pages (`https://<user>.github.io/yskeys/`) · UI language: English (hardcoded)

---

## 1. Goal

Make weak-key practice **automatic** instead of manual.

1. Open the page, type immediately — no account, no network, no setup.
2. After training, see exactly which characters and fingers you miss.
3. Drill those keys more often than the ones you already know, and see which finger to
   reach with before you press.
4. Practise material you actually care about: a word list, or your own code and text.
5. Take the data with you: export JSON, import it anywhere, and the profile continues.

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
  charsets, in one of three shapes:
  - **words** — chunks drawn from the word list the user imported;
  - **text** — chunks cut from the user's own plain text or code, with line breaks kept as
    real targets so the source's shape survives (F14);
  - **patterns** — random character groups from the enabled charsets.

  In `adaptive` mode (the default) what gets practised is chosen by the weights in F5; the drawn
  unit is then materialized into a chunk of the chosen shape. `uniform` mode skips weighting
  entirely. A shape whose material is missing is disabled in the header with the reason, and if the
  selected shape cannot be honoured at build time the drill falls back deterministically
  (words → text → patterns) rather than refusing to start. Show the target with the current position
  highlighted, and the next key's finger in the hint panel (F13).
- **Exceptions**: only one charset enabled → fine. Zero charsets enabled → block start and prompt
  to enable one. History exists but every unit has 0 attempts → fall back to cold-start prior.
  Text source that no enabled charset can type → nothing is imported, and the reason names the sets.

### F2 — Keystroke capture and judging
- **Trigger**: `keydown` while the practice view is focused.
- **Normal**: accept keys where `event.key.length === 1`, plus `Enter`, which is the newline target
  in the text/code shape; compare to `target[i]`. Correct → advance
  and mark correct. Wrong → advance anyway, mark red, record the miss against the **first** attempt
  at that position. `Backspace` corrects the display only; it never creates a new sample. The space
  between groups is an ordinary character here: judged, counted and recorded like any other key.
  `Enter` is only swallowed when the drill actually expects a newline at the cursor, so it keeps
  working as a browser key everywhere else.
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
- **Normal**: merge the session delta into `Aggregates` — `unigrams` and the
  per-finger, per-hand, per-Shift and per-character-kind counters — and write to `localStorage` under
  one versioned key, together with the settings. The imported word list and the imported text source
  each live under their own key, so history pruning and "clear all data" can never touch them. Keep
  the last 200 session summaries.
- **Exceptions**: `localStorage` unavailable or quota exceeded → app keeps working in memory, shows a
  persistent banner ("history is not being saved — export your data"), never throws. An unreadable
  payload is parked under a `yskeys:corrupt:` key instead of being overwritten. Payload over
  `MAX_PAYLOAD_CHARS` (2,000,000 UTF-16 code units, the unit browsers count against the ~5 MB quota)
  → prune the least-practised characters, then prompt an export.
  A v1 payload (which also held `bigrams`/`trigrams`) is migrated in place: the n-gram maps are
  dropped and the per-character history is kept.

### F5 — Adaptive weighting
- **Trigger**: every session build, in `adaptive` mode (the default). The mode control lives in the
  History view: it is a control for checking whether the adaptive part helps, not a daily setting.
- **Normal**: every enabled single character is a candidate. There are no pair or triple candidates —
  a pair re-counts the same keystroke as evidence and cannot be shown as the thing being practised.
  Weight is
  `max((1 - acc_smoothed)^2 × boost, 0.01)` with `boost = 2.5` under 10 attempts, and
  `UNSEEN_WEIGHT = 0.16` for a unit that has never been typed — roughly a 60%-accuracy unit, because
  reusing the display prior (0.9) would make the keys you have never touched the ones you practise
  least. **85% of draws follow those weights, 15% are uniform**, no unit comes up twice in a row, and
  a unit already drawn this session has its weight halved per prior use so one weak key cannot fill a
  whole drill.
- **Materialization**: the drawn unit is resolved to a chunk *containing* it, which is the only way a
  rare key is ever practised — 99 of EFF's 7776 words contain a `q`. In the **words** shape that chunk
  is a word from the list (only units some word can satisfy are candidates). In the **text** shape it
  is a run cut from the user's own material, at token boundaries and never spanning a line break. In
  the **patterns** shape the unit is emitted alone 30% of the time and inside a 3–5 character group
  otherwise, with filler only ever added before or after it so the unit stays contiguous.
- **Exceptions**: no history at all → cold-start prior (home row → top row → bottom row → number row,
  shifted characters halved), single characters only. No unit can be materialized (an empty word list,
  say) → the plain character generator runs. `uniform` mode skips weighting entirely and must keep
  working: it is the only way to tell whether the adaptive part does anything.

> Why there are no tiers. The first version of this spec drew 60% from "the weakest 30%", 25% from a
> middle tier and 15% uniformly. That structure caps the ratio between a bad unit and a good one at
> about 2x however the weights behave, which makes acceptance #6 unreachable — the weights are
> supposed to *be* the "how weak" signal. The same first version set the floor to 0.05, which lifted a
> 99%-accuracy unit until it was only 4.6x rarer than a 50% one. Both were caught by writing the
> acceptance test first.

### F6 — Accuracy definitions
- **Trigger**: weighting (F5). The history tables deliberately show **raw** accuracy instead.
- **Normal**: the stored record is a raw count. Weighting uses
  `acc_smoothed = (firstTryCorrect + 5×0.9) / (attempts + 5)` — a Beta prior so one attempt cannot
  produce 0% or 100%. A character's first try counts as correct when the first keystroke at that
  position matched, whatever happened after a Backspace.
- **Exceptions**: `n < 10` → flagged "low sample" in the history tables, which always print the
  sample size next to the number. Smoothing is kept out of those tables on purpose: showing a 0-of-1
  key as 75% would misrepresent what actually happened. Newlines and spaces are recorded exactly like
  characters — as a unigram, under `byKind['control']`/`byKind['space']`, and under the finger that
  presses them.

### F7 — History and weak-spot view
- **Trigger**: user opens History.
- **Normal**: totals, CPM trend (inline SVG, no chart library), and sortable weak-spot tables for
  single characters and fingers — sortable by accuracy / error count / sample size — plus the
  kind/Shift/hand breakdown.
- **Exceptions**: no data → empty state with a "start a session" link. Very long history → tables
  paginate or cap at top 15 per table.

### F8 — Export
- **Trigger**: "Export" in History.
- **Normal**: download `yskeys-export-YYYYMMDD-HHmm.json` (2-space indented) containing
  `kind`, `schemaVersion`, `exportedAt`, `app.version`, `settings`, `aggregates`, `sessions`, and the
  imported word list and text source when there are any.
- **Exceptions**: download blocked → offer a copy-to-clipboard textarea fallback.

### F9 — Import
- **Trigger**: user picks a JSON file and chooses **Replace** or **Merge**.
- **Normal**: Replace overwrites local data after snapshotting the current state to a one-step
  undo backup. Merge adds counters field-by-field, unions sessions by `id`, keeps the earlier
  `createdAt`. **Both modes adopt the settings from the file**, so the two modes differ only in how
  the numbers combine and the file is the single source of truth for what is being practised. A file
  that carries a word list or a text source replaces the local one; a file without them leaves the
  local ones untouched.
- **Exceptions**: malformed JSON / wrong `kind` → reject, keep current data, show the reason.
  `schemaVersion` newer than the app → refuse and ask the user to update the page. Older → run the
  migration chain (v1 n-gram payloads are accepted and their per-character history is kept). Merge
  with a file whose `schemaVersion` is older → migrate first, then merge.

### F10 — Settings
- **Trigger**: controls in the header. Six, in three groups:
  - **Character sets** — lowercase (default on), uppercase, digits, punctuation, programming symbols.
  - **Drill shape** — `Words` (default) / `Text / code` / `Patterns`, each disabled with a stated
    reason when its material is missing.
  - **Space marker** — `Bar` (default) / `Blank` / `Dot` / `Dash` (F12).
  - **Finger hint** — shown (default) / hidden (F13).
  - **Groups** — 15 / 30 (default) / 60, meaning a target of about 150 non-space characters.

  Mode `adaptive` (default) / `uniform` lives in the **History view** rather than the header.
  Changes apply to the **next** session, never mid-session.
- **Exceptions**: turning off all charsets is prevented at the UI level. Settings persist alongside
  history and are included in the export.

### F11 — Clear data
- **Trigger**: "Clear all data" + typed confirmation.
- **Normal**: delete the history store and settings, reset to cold start. The imported word list and
  text source survive on purpose: they are files the user had to fetch, not history they can
  regenerate.
- **Exceptions**: none — the confirmation is the guard. Undo is not offered here (export instead).

### F12 — Space marker
- **Trigger**: the header's space-marker control; applies to the next drill.
- **Normal**: every space in a drill is a real target, but an empty box is invisible, so the marker is
  chosen by the user: **Bar** (a short low rule, the default), **Blank** (nothing at all),
  **Dot** (a small centred pill) and **Dash** (a wide low rule). The marker inherits the character
  states (correct / missed / fixed / current), and all four are pure CSS on the same fixed-width span,
  so switching can never reflow the drill or change the target.
- **Exceptions**: none. With `Blank` the current-position highlight is the only cue that a space is
  there, which is the point of the option.

### F13 — Finger hint
- **Trigger**: the header's finger-hint control (on by default); updates on every keystroke.
- **Normal**: the practice view shows one sentence — "Next: `<key>` → `<finger>`" — and a US QWERTY
  diagram in which every key is tinted by the finger that owns it and the next key is marked with both
  a tint and a heavy border. Shifted characters name the finger that reaches for them and say which
  little finger holds Shift. A newline target is labelled `Enter ⏎`. The sentence is the accessible
  answer; the diagram is `aria-hidden`. The diagram is read from the same layout table that attributes
  the per-finger accuracy (F6), so the two can never disagree about which finger owns a key.
- **Exceptions**: the drill is finished or the character is not on the layout → the panel says so
  rather than showing a stale hint. Hiding the panel is one click.

### F14 — Text and code source
- **Trigger**: "Upload repository (.zip)", "Upload text or code files", or the paste box in History.
- **Normal**: the source is read **in the browser** and never uploaded. An archive is read with a
  minimal zip reader (central directory only, `DecompressionStream` for the inflate step — no
  dependency), filtered to known source extensions, and stripped of `node_modules`, `dist`,
  lockfiles and other generated trees. A set of plain-text files is read directly. The text is
  normalised (BOM, CRLF, untypeable characters), cut into chunks at token boundaries — never mid-word,
  never starting or ending with whitespace — and line breaks are **kept as targets**, so code keeps
  its shape and `Enter` is typed like any other key. The import reports how many files were used, how
  many characters and lines arrived, and how many files were skipped and why.
- **Exceptions**: not a zip → refused with the reason. Nothing in the source can be typed with the
  current character sets → refused, and the reason names the enabled sets. Only the first 200,000
  characters are kept. The source lives under its own key: history pruning never touches it, and
  "clear all data" keeps it, exactly like the word list.

## 4. Not doing (MVP non-goals)

| Not doing | Why |
| --- | --- |
| Chinese / pinyin / IME input | Composition state breaks keystroke attribution; different metric entirely |
| N-gram (pair/triple) statistics | Tried and dropped: a pair re-counts the same keystroke as evidence, and the display has no way to show a pair as the unit being practised. Single characters plus the finger/kind buckets carry the same signal |
| Bundling a word list or sample text in the repo | No third-party data ships here: you import a file you downloaded or wrote yourself, so no licence obligation attaches to the repository |
| Shipping a git client / cloning a repo over the network | No network is an architectural premise; a `.zip` the user already has is the upload path |
| Accounts, cloud sync, leaderboards, sharing | No backend is an architectural premise |
| Spaced repetition (SRS / Anki-style scheduling) | v2; MVP uses weighted sampling only |
| Multiple keyboard layouts (Dvorak/Colemak) | US QWERTY for display and finger attribution only |
| Touch / mobile virtual keyboard | Physical keyboard only |
| "Must fix the error to continue" mode | Decided: allow errors, judge per position |
| Sound, user-selectable themes, decorative animation | Not worth the budget. Dark mode follows the OS via `prefers-color-scheme` only — no switcher |
| PWA / service worker, SSR | Plain static site |
| i18n / language switcher | UI is hardcoded English |

Cut order if time runs short: per-key latency median → per-finger stats → the finger-hint diagram
(keeping the sentence) → the space-marker choices (keeping one fixed marker). Down to that point it is
still "an adaptive single-character trainer with its own material", which is the core value.

## 5. Tech choices

| Area | Choice |
| --- | --- |
| Build | Vite + TypeScript (`strict`), `base: '/yskeys/'` (injected as `--base=/yskeys/` in CI) |
| Tests | Vitest; all of `core/` and `store/` are pure functions, coverage ≥ 80% |
| Runtime deps | **Zero** — no framework, no chart library (inline SVG), no zip library (`DecompressionStream`), no fonts, no CDN, no analytics |
| Storage | `localStorage`, one versioned key for history + settings, one key each for the word list and the text source |
| Deploy | GitHub Actions: `main` → install → test → build → `actions/deploy-pages`; no secrets |
| Local dev | `pnpm dev` / `pnpm build` / `pnpm test` |

### Data model

The authoritative shapes live in `src/store/schema.ts`; this is only the summary.

- One `localStorage` key (`yskeys:v1:store`) holds `{ schemaVersion, settings, aggregates, sessions }`.
  Undo backups and parked unreadable payloads use separate key prefixes. `SCHEMA_VERSION` is 2; a v1
  payload is migrated by dropping `bigrams`/`trigrams` and renaming the `uniform` shape to `patterns`.
- Recorded dimensions: `unigrams`, `byFinger`, `byHand`, `byShifted`, `byKind`.
  Every dimension counts first-try attempts only, and keeps a per-unit confusion map of what was
  actually typed. Pairs and triples are deliberately **not** recorded (see §4).
- **Chunks are separated by a real space character, which is a target.** It is typed like any other
  key, recorded as a unigram, and attributed to `byFinger['thumb']` and `byKind['space']`. A drill of
  30 groups therefore has 179 characters, not 150. Space is deliberately **not** one of the five
  selectable charsets: it is never optional, it is the separator. How it is *drawn* is a setting
  (F12); what it *is* is not.
- In the text/code shape a **newline is a target too**: it is recorded as a unigram, attributed to
  `byKind['control']` and the Enter finger, and rendered as an actual line break. `Enter` is only
  intercepted while the cursor is on one.
- The **imported word list** lives under its own key (`yskeys:v1:words`), outside the history store:
  the budget guard must never prune it and "clear all data" must never delete a file you had to
  download. An export carries it; an import that has one replaces it, and one that does not leaves it
  alone. Parsing is deliberately permissive (dice numbers, comments, CRLF, any printable ASCII) and
  reports how many lines it skipped; usability is decided per session, because the enabled charsets can
  change after the import. There is no bundled list.
- The **text/code source** has the same contract under `yskeys:v1:text`, and stores the normalised
  practice text plus the stats the History view reports. Extracted chunks are recomputed from that
  text on every session build, so changing the enabled charsets immediately changes what can be
  drilled out of it.
- `settings` is `{ charsets, groupCount, shape, mode, spaceDisplay, nextKey }`, with the last four
  optional in the validator so older imports still load; `preferredShape`/`preferredSpaceDisplay`/…
  supply the defaults in one place.
- An export file is
  `{ kind, schemaVersion, exportedAt, app, settings, aggregates, sessions, wordList?, textSource? }`.

Layout:

```
yskeys/
├─ PROJECT.md · DESIGN.md · README.md
├─ index.html
├─ package.json · tsconfig.json · vite.config.ts · pnpm-workspace.yaml
├─ public/favicon.svg
├─ .github/workflows/deploy.yml
└─ src/
   ├─ main.ts          # wiring: views, keyboard, session lifecycle, source imports
   ├─ config.ts        # all tunables (γ, α, boost, mix ratios, lengths, size guards)
   ├─ vite-env.d.ts    # Vite ambient types (asset imports)
   ├─ core/            # pure, no DOM: charset, random, generator, wordlist, sourcetext,
   │                   # archive, engine, metrics, layout, adaptive
   ├─ store/           # schema (+validators), migrations, aggregate, persistence, transfer,
   │                   # wordlist, textsource
   ├─ ui/              # dom, format, stat, banner, chart, dialogs, settings-controls,
   │                   # finger-diagram, typing-view, result-view, history-view, styles.css
   └─ test/            # invariant tests for core/ and store/, plus the DOM-level app test
```

Data flow: `charsets + words|text → adaptive.weights → generator.buildAdaptiveDrill → engine →
SessionSummary + SessionTally → aggregate.applySession → persistence.save → result/history views`.
Sources flow: `file|zip → archive.readZipEntries → sourcetext.extractSourceText → store/textsource`.

## 6. MVP done when

1. `pnpm build` deploys to the Pages subpath; refreshing any deep link does not 404.
2. Zero third-party network requests in the built artifact (verified in the Network panel).
3. After a 30-group session, `attempts` / `firstTryCorrect` deltas exactly match the keystrokes.
4. Export → clear → import (Replace) round-trips to an identical store, field by field.
5. Importing the same file twice in Merge mode exactly doubles counters and does not duplicate sessions.
6. With a 26-letter pool where `a` is at 50% and `b` at 99% (100 attempts each), 10,000 draws with
   the in-session decay off put `a` ≥ 5× more often than `b`; and every unit, including a
   100%-accuracy one, is drawn at least half its guaranteed exploration share (0.15 / pool size).
7. History survives reload; broken/blocked `localStorage` degrades gracefully with a banner.
8. A repository `.zip` and a pasted block both produce a drill; every newline in a text drill is a
   real target that `Enter` advances.
9. `pnpm test` green, no console errors, and §4 non-goals are genuinely absent.

## 7. Later

**v1.1** — code-shaped tokens for the symbol and digit charsets (the current answer for those is still
random groups), a per-finger heat map over the whole history, goals/streaks, multiple named sources.
**v2** — move to IndexedDB with a raw keystroke event log, SRS scheduling, multiple layouts,
File System Access API auto-save to a local folder.

Rejected outright: generated pronounceable pseudo-words. A word list the user chooses is better
practice material and needs no invented data. Rejected after trying them: n-gram statistics — see §4.
