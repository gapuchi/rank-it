# rank-it

Track movies, TV shows, and video games you have completed, then rank each
category through a short series of pairwise comparisons.

## Development

Enter the reproducible development shell:

```sh
nix develop
```

Run tests and type checking:

```sh
npm test
npm run check
```

## Usage

Create users and list them:

```sh
npm run rank-it -- users create Alice
npm run rank-it -- users list
```

Add an item for a user. Titles with spaces may be passed as separate arguments
or quoted. Omit `--user` to use the `default` user (created automatically on
first use):

```sh
npm run rank-it -- add movies Arrival
npm run rank-it -- add video-games "Outer Wilds" --user Alice
```

The first item in a category is ranked immediately. Every later item is placed with pairwise comparisons against existing entries.

Import unordered titles from a CSV file with a `title` column. Each title is
placed through the same pairwise comparisons and saved as soon as it is ranked:

```csv
title
Arrival
Moonlight
Parasite
```

```sh
npm run rank-it -- import movies ./movies.csv --user Alice
```

Imports append to the existing ranking by default. Pass `--replace` to build a
new ranking for the category from only the imported titles:

```sh
npm run rank-it -- import movies ./movies.csv --replace
```

List a category:

```sh
npm run rank-it -- list movies --user Alice
```

Use the displayed item ID to delete or re-rank an item:

```sh
npm run rank-it -- delete movies <item-id> --user Alice
npm run rank-it -- rerank movies <item-id>
```

Data defaults to `~/.local/share/rank-it/rank-it.db`. Override paths and the default user when needed:

```sh
RANK_IT_DB=/path/to/rank-it.db RANK_IT_USER=Alice npm run rank-it -- list movies
```

## Web app

The CLI and the web app are both thin adapters over the same core
`CatalogService`, so they share ranking logic and storage. Start the web server:

```sh
npm run serve
```

Then open `http://127.0.0.1:4000`. Use `npm run dev` for auto-reload during
development. The server reads the same `RANK_IT_DB` database as the CLI and can
be configured with environment variables:

- `PORT` — port to listen on (default `4000`)
- `HOST` — interface to bind (default `127.0.0.1`)
- `RANK_IT_DB` — SQLite database path
- `RANK_IT_USER` — name of the user created on first start (default `default`)

Rankings are per user, so the page has a user picker that switches between the
same users the CLI manages.

### HTTP API

The server exposes a small JSON API under `/api`. Placing an item takes several
comparisons, so adding or re-ranking returns a `sessionId` plus the first
`prompt`; answer prompts until one has `type: "done"`. An item added to an empty
category needs no comparisons and comes back done with a `null` session.

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Liveness check |
| `GET /api/categories` | List categories |
| `GET /api/users` | List users |
| `POST /api/users` | Create a user; body `{ name }` |
| `GET /api/users/:userId/categories/:category/items` | List ranked items |
| `POST /api/users/:userId/categories/:category/items` | Add an item; body `{ title }` |
| `DELETE /api/users/:userId/categories/:category/items/:id` | Delete an item |
| `POST /api/users/:userId/categories/:category/items/:id/rerank` | Start a re-rank session |
| `POST /api/sessions/:id/answer` | Answer a comparison; body `{ better }` |

Ranking sessions are held in memory in the server process, which suits a
single-instance deployment.
