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

Live at <https://yienschwen.github.io/yskeys/> after the first successful workflow run.

1. Push to `main` — the `Deploy to GitHub Pages` workflow typechecks, tests, builds and deploys.
2. Pages is enabled by the workflow itself (`configure-pages` with `enablement: true`). If that step
   fails, enable it by hand: **Settings → Pages → Build and deployment → Source = GitHub Actions**,
   then re-run the workflow. Pushing alone is not enough in that case.
3. The first run takes a minute; the site appears at the URL above once the `deploy` job is green.

The base path `/yskeys/` is set in `vite.config.ts` and **must match the repository name**,
otherwise every built asset 404s on the Pages subpath.

## Data

Nothing is uploaded and there is no analytics. Typing history stays in this browser's
`localStorage`; export/import (JSON) arrives with M2. See `PROJECT.md` §4 for what this
project deliberately does not do.
