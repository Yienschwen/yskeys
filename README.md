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

## Data

Nothing is uploaded and there is no analytics. Typing history stays in this browser's
`localStorage`; export/import (JSON) is in the History view. See `PROJECT.md` §4 for what this
project deliberately does not do.

**Use one origin consistently.** The custom domain answers on both `http://` and `https://`, and a
browser treats those as two different origins with two separate `localStorage` stores. Type on both
and you will appear to have two unrelated histories. Pick `https://` and stay there.
