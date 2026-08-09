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

Add an item. Titles with spaces may be passed as separate arguments or quoted:

```sh
npm run rank-it -- add movies Arrival --year 2016
npm run rank-it -- add video-games "Outer Wilds" --notes "Explore freely"
```

The first item is ranked immediately. Later items start with a great, okay, or
bad bucket and then use pairwise comparisons to find their position.

List a category:

```sh
npm run rank-it -- list movies
```

Use the displayed item ID to delete or re-rank an item:

```sh
npm run rank-it -- delete movies <item-id>
npm run rank-it -- rerank movies <item-id>
```

Data defaults to `~/.local/share/rank-it/rank-it.db`. Override it when needed:

```sh
RANK_IT_DB=/path/to/rank-it.db npm run rank-it -- list movies
```
