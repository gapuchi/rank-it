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

Add an item for a user. Titles with spaces may be passed as separate arguments or quoted. Omit `--user` to use the `default` user (created automatically on first use):

```sh
npm run rank-it -- add movies Arrival --year 2016
npm run rank-it -- add video-games "Outer Wilds" --user Alice --notes "Explore freely"
```

The first item in a category is ranked immediately. Every later item is placed with pairwise comparisons against existing entries.

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
