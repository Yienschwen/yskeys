# yskeys — DESIGN.md

Visual and interaction rules for the MVP described in `PROJECT.md`.
Scope: design tokens, layout, component states, responsive behavior, accessibility.
Out of scope: product scope (see `PROJECT.md`), algorithm details (see `PROJECT.md` §5–6).

Implementation: **one hand-written `src/ui/styles.css`**. No CSS framework, no UI library, no webfonts.
Tokens are CSS custom properties on `:root`; components reference **semantic tokens only**, never palette values.

---

## 1. Foundations

### 1.1 Design principles

1. **The drill is the interface.** Everything else is quieter than the text being typed.
2. **Monospace is structural, not decorative.** The drill must never reflow or shift when states change.
3. **State is never color-only.** Every colored state also carries a shape cue (underline, border, weight).
4. **Keyboard-first.** No interaction requires a pointer. Nothing steals `Tab`.
5. **No motion in the reading path.** Transitions are feedback (<150 ms, color/opacity only).

### 1.2 Typography

Two families, both from the system stack (zero network cost):

```css
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

All sizing in `rem` so browser zoom works. `--font-mono` is used for the drill, stats, tables, and any
string the user is expected to type (`[]`, `;'`, etc.). UI chrome uses `--font-ui`.

| Token | Size / line-height | Weight | Use |
| --- | --- | --- | --- |
| `--text-xl` | `clamp(1.75rem, 4vw, 2.5rem)` / 1.4 | 400 | Drill text (desktop) |
| `--text-lg` | `1.25rem` / 1.5 | 600 | View titles, big stat numbers |
| `--text-md` | `0.9375rem` / 1.5 | 400 | Body, table cells, buttons |
| `--text-sm` | `0.8125rem` / 1.45 | 500 | Labels, table headers |
| `--text-xs` | `0.75rem` / 1.4 | 500 | Hints, sample counts, legends |

Rules: drill text uses `letter-spacing: 0.02em`; `font-variant-numeric: tabular-nums` on **all** numbers
(stats, timers, CPM, counts) so values do not jitter as they update.

### 1.3 Spacing

4 px base. Only these values are allowed; no arbitrary margins.

| Token | Value | Typical use |
| --- | --- | --- |
| `--space-0` | `0` | reset |
| `--space-1` | `4px` | icon-to-label gap, tight inline |
| `--space-2` | `8px` | inside buttons/pills, char cell padding |
| `--space-3` | `12px` | label-to-control, table cell padding |
| `--space-4` | `16px` | card padding, control group gap |
| `--space-5` | `24px` | section gap, drill top/bottom |
| `--space-6` | `32px` | view padding (desktop) |
| `--space-7` | `48px` | drill vertical breathing room, view padding (≥1200px) |
| `--space-8` | `64px` | empty-state centering only |

### 1.4 Shape, elevation, layers, motion

```css
--radius-sm: 3px;   /* pills, key caps, char highlight */
--radius-md: 6px;   /* buttons, inputs, cards */
--radius-lg: 10px;  /* dialogs, drop zone */

--border-w: 1px;              /* default hairlines */
--border-w-strong: 2px;       /* focus ring, error underline, current position */

--shadow-sm: 0 1px 2px rgb(0 0 0 / 0.06);
--shadow-md: 0 4px 16px rgb(0 0 0 / 0.12);   /* dialogs only */

--z-base: 0; --z-sticky: 10; --z-banner: 20; --z-dialog: 30; --z-debug: 99;

--dur-fast: 90ms;    /* hover / press feedback */
--dur-base: 140ms;   /* focus ring, banner reveal */
--ease: cubic-bezier(0.2, 0, 0.2, 1);
```

Motion budget: only `color`, `background-color`, `border-color`, `opacity`, `box-shadow`. **Never**
transition `width`, `height`, `top`, `left`, or the drill text. There is no animated caret; the current
position is shown as a static highlight.

### 1.5 Responsive breakpoints

Desktop-first. The product requires a physical keyboard, so small screens get a gate, not a redesign.

| Token | Value | Behavior |
| --- | --- | --- |
| `--bp-sm` | `640px` | Below: **practice is gated** (see §5.3); history/result stack to one column; tables scroll horizontally |
| `--bp-md` | `900px` | Below: header controls wrap to two rows; drill text uses the lower `clamp()` bound; stat row wraps |
| `--bp-lg` | `1200px` | At/above: full layout — drill column `max-width: 60rem`, history column `max-width: 68rem`, `--space-6/7` padding |
| `--bp-xl` | `1600px` | Above: content width stops growing; side whitespace only |

Coarse pointers are gated by capability, not width:

```css
@media (pointer: coarse) { /* practice view shows the physical-keyboard notice */ }
```

---

## 2. Color

Two tiers. **Palette** tokens (`--c-*`) are raw values and are never used by components. **Semantic**
tokens (`--bg`, `--text`, …) are the only thing components may reference. Dark mode is automatic via
`prefers-color-scheme`; there is no in-app switcher (see §8).

### 2.1 Semantic tokens

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--bg` | `#ffffff` | `#0f1115` | Page background |
| `--surface` | `#f9fafb` | `#171a20` | Cards, header, table stripes |
| `--surface-2` | `#f3f4f6` | `#1f232b` | Inset areas, key caps, hovered rows |
| `--border` | `#d1d5db` | `#2b3038` | Hairlines, table rules, input borders |
| `--border-strong` | `#9ca3af` | `#3f4652` | Emphasis borders, disabled text (light) |
| `--text` | `#111827` | `#e8eaed` | Primary text, **typed-correct** drill chars |
| `--text-muted` | `#4b5563` | `#a8b0bb` | Secondary text, labels, stats |
| `--text-faint` | `#6b7280` | `#8b939f` | Hints, **untyped** drill chars, legends |
| `--accent` | `#1d4ed8` | `#60a5fa` | Primary action, current position, focus |
| `--accent-hover` | `#1e40af` | `#93c5fd` | Hover on accent surfaces |
| `--accent-subtle` | `#eff6ff` | `#1a2740` | Current-char background, selected pills |
| `--accent-border` | `#93c5fd` | `#3b82f6` | Accent outlines |
| `--correct` | `#15803d` | `#4ade80` | Success text/icons (not used for drill text) |
| `--correct-subtle` | `#f0fdf4` | `#12291c` | Success tint |
| `--error` | `#b91c1c` | `#f87171` | Error text, error borders |
| `--error-subtle` | `#fef2f2` | `#3a1a1e` | Missed-char background |
| `--warning` | `#92400e` | `#fbbf24` | Storage banner, low-sample marks |
| `--warning-subtle` | `#fffbeb` | `#3a2f10` | Warning banner background |

### 2.2 Contrast targets

- Body/secondary text vs its background: **≥ 4.5:1**.
- Disabled text: **≥ 3:1** (it is still information), and must also be marked as disabled by other means.
- Borders of interactive controls: **≥ 3:1** against adjacent background.
- Error text on `--error-subtle`: verified ≥ 4.5:1 in both modes.
- Ratios above are targets to verify with a contrast checker when tokens change; **do not** ship a token
  pair that was never checked.

### 2.3 Drill character states

| State | Class | Appearance | Non-color cue |
| --- | --- | --- | --- |
| Untyped | *(default)* | `color: var(--text-faint)` | — |
| Typed correct | `.is-ok` | `color: var(--text)` | — |
| Missed (first attempt wrong) | `.is-bad` | `color: var(--error)`; `background: var(--error-subtle)` | `border-bottom: var(--border-w-strong) solid var(--error)` |
| Fixed after backspace | `.is-fixed` | `color: var(--warning)` | `border-bottom: 2px dashed var(--warning)` |
| Current position | `.is-current` | `background: var(--accent-subtle)`; `box-shadow: inset 0 -2px 0 var(--accent)` | inset underline marks the slot |
| Current + missed | `.is-current.is-bad` | both rules; error underline wins on the bottom edge | error underline retained |
| Upcoming (paused / pre-start) | `.is-pending` | same as untyped, `opacity: 0.55` | — |

Structural rules:
- Every character is its own `<span>` with fixed `min-width: 0.62em` (mono advance) so **no state
  change can reflow the line**. `.is-bad` must not change font-weight or padding.
- A drill **group** (5 chars) is a `<span class="group">`; `.group.is-active` gets `border-radius:
  var(--radius-sm)` and a `--surface` background; `.group.is-done` is dimmed with `opacity: 0.7`.
- Group separator: `--space-2` gap plus a `·` in `--border-strong` for low-vision/forced-colors contexts.
- Long sessions wrap at **group boundaries** only, so a group is never split across lines.
- The drill area has `min-height: 3 lines` reserved so the page does not jump when the string wraps.

---

## 3. Component rules

Naming: `.c-<component>` block, `.c-<component>__<element>`, `.is-<state>` /
`.has-<state>` modifiers. Component-level state may also be exposed as `data-state="…"` when the
renderer sets it in one place. Only one source of truth per state.

### 3.1 State matrix

| Component | Default | Hover | Active / pressed | Focus-visible | Disabled | Error |
| --- | --- | --- | --- | --- | --- | --- |
| Button (primary) | `--accent` bg, white text | `--accent-hover` | `--accent-hover`, `translateY(0)` *(no transform; use `--surface-2` overlay)* | ring §4.1 | 45% opacity, `cursor: not-allowed`, no hover change | n/a |
| Button (secondary) | `--surface` bg, `--border` | `--surface-2` | `--surface-2` + `--border-strong` | ring | same | n/a |
| Button (ghost) | transparent, `--text-muted` | `--surface-2` | `--surface-2` + `--border` | ring | same | n/a |
| Button (danger) | transparent, `--error` text, `--border` | `--error-subtle` | `--error-subtle` + `--error` border | ring (error-colored) | same as others | n/a |
| Charset toggle (pill) | `--surface-2`, `--text-muted` | `--surface-2` + `--border-strong` | same | ring | — | — |
| Charset toggle (on) | `--accent-subtle` bg, `--accent` text, `--accent-border` border, **✓ glyph** | `--accent-subtle` + `--accent` border | same | ring | — | — |
| Select / Segmented | `--surface` bg, `--border` | `--surface-2` | same | ring | 45% opacity | n/a |
| Text input (import search, confirm field) | `--bg`, `--border` | `--border-strong` | same | ring | 45% opacity | `--error` border + inline message |
| Table row | transparent | `--surface-2` | n/a | n/a | n/a | `.is-worst` row: `--error` left border 2px |
| Banner (info / warning / error) | `--accent-subtle` / `--warning-subtle` / `--error-subtle` + matching left border 3px | — | — | — | dismiss button hidden when not dismissible | n/a |
| File drop zone | dashed `--border`, `--surface` | `--accent-border` dashed, `--accent-subtle` | same | ring | — | `--error` dashed + message |
| Dialog | `--bg`, `--shadow-md`, `--radius-lg` | — | — | focus trapped (§4.2) | confirm button disabled until input matches | n/a |

Disabled rule: `disabled` attributes **and** `aria-disabled="true"` where the control must stay
focusable (e.g. a charset pill in a locked state). Never rely on opacity alone — add
`cursor: not-allowed` and keep the label readable at ≥3:1.

### 3.2 Stat readout

Label above value. Label `--text-xs` `--text-muted`; value `--text-lg` mono `tabular-nums`.
When a value has no data: show `—`, never `0`, and set `title`/`aria-label` to "no data yet".
Live values update in place; they must not resize their container (fixed `min-width` per stat).

### 3.3 Progress

Session progress is a 2 px `--accent` bar on `--surface-2`, full viewport width, pinned under the
header. It reflects **position**, not correctness, and is `aria-hidden` (the stat readout is the
accessible source).

### 3.4 Weak-spot table

- Header row: sticky, `--surface`, `--text-sm`, sortable — sort control is a real `<button>` with
  `aria-sort` on the `<th>`, indicator is a shape (`▲`/`▼`), not color.
- Columns: unit (mono), accuracy (mono + `%`), errors, sample size. Units with `n < 10` get a
  `--warning` "low sample" dot plus `title="fewer than 10 attempts"`.
- Top-15 per table by default; "show all" reveals the rest. Rows are never expandable.

### 3.5 Chart (inline SVG, no library)

- 1 px `--accent` polyline, 2 px dots at points, `--border` baseline only (no grid, no axes box).
- `role="img"` with an `aria-label` summarizing the trend ("CPM over the last 20 sessions: 240 → 318"),
  plus a visually hidden data table for the same numbers.
- Fewer than 2 points → render the empty state instead of a degenerate line.

### 3.6 Heatmap (cuttable, F12)

- US QWERTY rows drawn with CSS grid; each key `min-width: 2.4rem`, `min-height: 2.4rem`,
  `--radius-sm`, staggered row offsets of 0 / 0.4 / 0.9 key widths.
- 5 accuracy buckets: `<60%` → `--error`, `60–79%` → `--warning`, `80–94%` → `--accent`,
  `≥95%` → `--correct`, **no data** → `--surface-2` with a dashed `--border`.
  Every bucket is also distinguishable by a border treatment, so the map survives grayscale.
- Legend below the map shows bucket ranges and sample counts.
- Below `--bp-md` the map gets `overflow-x: auto` with `min-width: 40rem`; it never scales below legibility.

---

## 4. Interaction and focus

### 4.1 Focus

```css
:focus-visible { outline: var(--border-w-strong) solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }
```

- `:focus-visible` only — no focus rings on mouse clicks, always present for keyboard.
- The ring must be visible on every background used (`--bg`, `--surface`, `--accent-subtle`,
  `--error-subtle`); use `outline-offset` rather than inner shadows so it is not clipped by
  `overflow: hidden`.
- The practice view holds focus for typing; clicking anywhere in the drill area returns focus to it.

### 4.2 Dialogs

Native `<dialog>` with `::backdrop { background: rgb(0 0 0 / 0.45) }`. Focus is trapped, `Esc` closes
(non-destructive actions only), and focus returns to the invoking control on close. `Esc` inside a
**destructive** confirmation cancels the dialog rather than confirming it.

### 4.3 Reserved keys

| Key | Action | Notes |
| --- | --- | --- |
| printable `key.length === 1` | type | ignored when a dialog is open |
| `Backspace` | fix display only | `preventDefault()` so it never navigates |
| `Esc` | abort session / close dialog | in the destructive dialog it cancels |
| `Enter` | start next session (from result view) | must not trigger while typing mid-session |
| `Tab` / `Shift+Tab` | **never intercepted** | keyboard navigation, see §8 |

### 4.4 State transitions and feedback

- Starting a session: drill appears fully rendered in the untyped state; the current position is
  marked immediately. No countdown animation.
- Pause (window blur): drill is replaced by a `--surface` panel — "Paused — click to resume" — the
  timer stops, and nothing about the session is scored while paused.
- Finish: shift to the result view within `--dur-base`; the last session's weak units are highlighted
  in that table. No celebratory animation.
- Errors during typing: state changes are applied on the same frame as the keystroke. No toast per
  error — the inline `.is-bad` marker is the only feedback.

---

## 5. Layout

### 5.1 Shell

```
┌─ sticky header ────────────────────────────────────────────────┐
│ yskeys   [charsets]  [length] [mode]        [History] [Export] │
│ ── 2px progress bar (practice only) ────────────────────────── │
└────────────────────────────────────────────────────────────────┘
  banner slot (storage warning) — pushes content down, never overlays
  <main>
    practice: centered column, max-width 60rem
    result:   centered column, max-width 60rem
    history:  max-width 68rem, sections stacked with --space-6
```

- Header is `position: sticky; top: 0; z-index: var(--z-sticky)` with a `--border` bottom hairline and
  `--bg` background (opaque, so drill text never scrolls behind it).
- Banners sit in normal flow below the header (§3.1) — they must not cover the drill.
- Only one view is in the DOM at a time; view switching does not animate position.
- Vertical rhythm is `--space-5` between blocks inside a view, `--space-6/7` for view padding.

### 5.2 Minimum usable width

Practice view requires **640 px**. Below that (or on a coarse pointer) the gate replaces it.

### 5.3 Practice gate (small screen / touch)

A centered `--surface` card, `--radius-md`, one `--text-lg` line — "yskeys needs a physical keyboard" —
one `--text-md` `--text-muted` line explaining that history and export are still available, and a
`Continue to history` secondary button. Gate applies to **practice only**; result and history remain
readable and exportable on a phone, since that is how data gets off a locked-down machine.

### 5.4 Empty and loading states

Every view defines an empty state: a single `--text-muted` sentence plus at most one action
("Start a session", "Go to practice", "Import a file"). No illustrations, no skeletons — the app has
no async loading, so a spinner would be a lie.

---

## 6. Accessibility

- **Never color-only.** Error/missed, fixed, current, and every heatmap bucket carry a border or
  shape cue in addition to color (§2.3, §3.6).
- Live regions: stat readout is `aria-live="off"` (too chatty) but the result summary is announced via
  `role="status"`. Errors and import failures use `role="alert"` **once**, never per keystroke.
- Target size: ≥ 32×32 px for pointer targets (desktop), ≥ 44×44 px on touch — but the practice view is
  pointer-free by design; toggles are the only pointer-critical controls.
- Full keyboard operation of settings, history, and dialogs. `Tab` order follows visual order.
- The drill is a `<div role="application">` with `aria-label` describing the task and an
  `aria-describedby` pointing to a hidden live region with the current position and last judgement
  (e.g. "position 12 of 150, expected t, correct").
- `forced-colors: active` → rely on system colors; the `.is-bad` bottom border and `.is-current` inset
  underline become the primary differentiators, so they must not be `box-shadow`-only.
- `prefers-reduced-motion: reduce` → set `--dur-fast`/`--dur-base` to `0ms`; nothing else changes,
  because no layout or movement animation exists.

---

## 7. Token source of truth

```css
:root {
  /* palette (--c-*) then semantic tokens; dark overrides in one media block */
}
@media (prefers-color-scheme: dark) { :root { /* semantic tokens only */ } }
@media (prefers-reduced-motion: reduce) { :root { --dur-fast: 0ms; --dur-base: 0ms; } }
```

Rules:
1. New colors are added as a semantic token **and** both light and dark values in the same commit.
2. Components never use `--c-*`, hex values, or `rgb()` directly.
3. `styles.css` is ordered: tokens → resets → typography → layout → components (header, drill, stats,
   table, banner, dialog, chart, heatmap) → utilities → media queries. No `!important` outside
   `forced-colors` overrides.
4. Any token removed from the file must be removed from this document.

---

## 8. Resolved conflicts with PROJECT.md

Both items below contradicted decisions recorded in `PROJECT.md`; both were decided on 2026-02-13 and
`PROJECT.md` has been updated to match.

1. **Dark mode — accepted, narrow reading.** Dark mode ships **via `prefers-color-scheme` only**: one
   media block overriding semantic tokens. No switcher, no persistence, no theme setting in the UI.
   `PROJECT.md` §4's non-goal now reads "user-selectable themes"; the auto dark column in §2.1 stands.
2. **`Tab` is not a shortcut.** `PROJECT.md` F2 originally assigned `Tab` to "restart", which would
   trap keyboard users in the practice view. Decided: `Tab`/`Shift+Tab` are never intercepted; `Esc`
   aborts/restarts and `Enter` advances from the result view (§4.3). `PROJECT.md` F2 now matches.
