# AGENTS.md

## Cursor Cloud specific instructions

`rank-it` is a single Node.js/TypeScript package (no workspaces) that tracks and
ranks movies, TV shows, and video games via pairwise comparisons. A CLI, an HTTP
API, and a React web app are all thin adapters over the same core
`CatalogService` with SQLite storage (`better-sqlite3`).

Standard commands live in `package.json` scripts and the `README.md`; use those
as the source of truth. Node 22+ is required (`engines.node >= 22`); the VM's
default Node already satisfies this, so `nix`/`just` (referenced in the README)
are not needed here — call the underlying `npm` scripts directly.

Non-obvious notes for running/testing services:

- Data is SQLite. Set `RANK_IT_DB` to a scratch path (e.g. `RANK_IT_DB=/tmp/rank-it.db`)
  when running the CLI/API/serve so you don't touch the default DB at
  `~/.local/share/rank-it/rank-it.db`. `*.db` files are gitignored.
- `better-sqlite3` is a native addon compiled during `npm ci` (needs
  python3 + a C/C++ toolchain, both preinstalled). It is tied to the Node ABI, so
  after a Node version change re-run `npm ci` to rebuild it.
- Dev servers: `npm run dev` runs the API (`tsx watch src/api/main.ts`, port 4000)
  and Vite (port 5173) concurrently. Vite binds to `localhost` only — reach it at
  `http://localhost:5173`, NOT `http://127.0.0.1:5173` (127.0.0.1 refuses the
  connection).
- KNOWN DEV-MODE BUG (repo code, not environment): under `npm run dev` the web UI
  renders a blank page. Vite serves the frontend's `src/web/api.ts` module at the
  URL `/api.ts`, but `vite.config.ts`'s proxy rule `"/api": "http://127.0.0.1:4000"`
  uses prefix matching and also intercepts `/api.ts`, proxying it to the backend
  which returns HTML — the browser rejects the bad MIME type and React never
  mounts. To exercise the full web UI, use the production server instead:
  `npm run serve` (builds the web app, then serves it from the API on port 4000 with
  no proxy). Configure with `PORT`, `HOST`, `RANK_IT_DB`, `RANK_IT_USER`.
- The CLI's interactive `[y/n]` ranking prompts read a single keypress when stdin
  is a TTY; when piping input non-interactively, send `y`/`n` lines on stdin.
- Ranking sessions (the pairwise-comparison state) are held in memory in the API
  process, so restarting the server drops any in-progress ranking session.
