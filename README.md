# yskeys

A static typing trainer that drills your weakest characters and letter pairs.
No backend: history lives in `localStorage` and can be exported to, and reloaded from, a local JSON file.

**Status: M0** — build pipeline, design tokens and the app shell only. The typing engine lands in M1.

- Scope and MVP definition → [`PROJECT.md`](./PROJECT.md)
- Visual and interaction rules → [`DESIGN.md`](./DESIGN.md)

## Requirements

- Node ≥ 22.12 (Vite 8 requires it)
- pnpm 12 — pinned via the `packageManager` field in `package.json`

If `pnpm: command not found`, its install location is not on your `PATH` for non-interactive
shells. It lives at `~/Library/pnpm/bin/pnpm`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dev dependencies (no runtime dependencies exist) |
| `pnpm dev` | Dev server at http://localhost:5173/yskeys/ |
| `pnpm test` | Run the unit tests once |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serve the built output at http://localhost:4173/yskeys/ |
| `pnpm coverage` | Tests with coverage; thresholds are enforced for `src/core` and `src/store` |

## Deploy

Live at <https://github.yienschwen.top/yskeys/>.

This repository has a **custom Pages domain** configured, so `https://yienschwen.github.io/yskeys/`
answers `301` and redirects to it — the github.io URL is never the final destination. The base path
below is unaffected either way.

**One-time setup, and it must be done by a human:**

**Settings → Pages → Build and deployment → Source = `GitHub Actions`.**

The workflow cannot do this for you. `GITHUB_TOKEN` is not allowed to *create* a Pages site —
`POST /repos/{owner}/{repo}/pages` returns `Resource not accessible by integration`, which is why
`configure-pages` is called without `enablement: true`. Do not add that input back; it fails on a
repository that has never had Pages enabled.

Then:

1. Push to `main`, or click **Actions → Deploy to GitHub Pages → Run workflow**
   (`workflow_dispatch` is enabled, so enabling Pages does not require an extra commit).
2. Check the deployed *assets*, not just the root page — if the base path and the repository name
   disagree, `/yskeys/` still returns 200 while every `.js` and `.css` request 404s.

The base path `/yskeys/` is set in `vite.config.ts` and **must match the repository name**,
otherwise every built asset 404s on the Pages subpath.

## Word list

Real-word drills need a list, and **none is bundled**: download one and import it via
**History → Word list → Import**. Nothing is ever fetched over the network.

Recommended sources, with figures measured from the actual files:

| List | Size | Word length | Licence | Notes |
| --- | --- | --- | --- | --- |
| [EFF short wordlist](https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt) | 1,296 words, 13 KB | 3–5, avg 4.5 | EFF site content is CC BY; the file itself carries no licence header | Best first choice: short familiar words, pre-filtered for profanity, homophones and hard spellings |
| [EFF long wordlist](https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt) | 7,776 words, 106 KB | 3–9, avg 7.0 | same | More variety, longer words. Design notes [here](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases) |
| [dwyl/english-words](https://github.com/dwyl/english-words) | 479k words, ~4.5 MB | 1–31 | **Unlicense (public domain)** — the only clearly unencumbered one | But it is an exhaustive dictionary: obscure words, no frequency order, and too large to import |
| [google-10000-english](https://github.com/first20hours/google-10000-english) | 10k words, ~80 KB | — | unclear (`NOASSERTION`, derived from Google's corpus) | Good words, unclear licence — avoid it in anything you redistribute |

Format: one word per line. EFF's `24255<TAB>word` shape also works, as do `#` comments, blank lines, a
BOM and CRLF line endings. Anything that is not a single printable non-space ASCII run is skipped, and
the import report says how many lines were skipped and how many of the kept words your current
character sets can actually type.

Worth knowing:

- **Use a frequency-ordered list, not a dictionary.** Rare words make poor practice material.
- Words with hyphens (EFF has four: `drop-down`, `felt-tip`, `t-shirt`, `yo-yo`) are kept by the
  importer but never used by the letter-only word drill.
- The words shape needs **letter-only character sets**. Enable digits or symbols and drills fall back
  to random character groups, because a word list cannot express them.
- A word list is an asset, not history: **Clear all data** deliberately keeps it, and so does history
  pruning.

## Data

Nothing is uploaded and there is no analytics. Typing history stays in this browser's
`localStorage`; export/import (JSON) is in the History view. See `PROJECT.md` §4 for what this
project deliberately does not do.

**Use one origin consistently.** The custom domain answers on both `http://` and `https://`, and a
browser treats those as two different origins with two separate `localStorage` stores. Type on both
and you will appear to have two unrelated histories. Pick `https://` and stay there.
