# Scratch: rank-it

Mutable progress notes—update during implementation. Plan lives in `plan.md`.

## Current

- **Commit:** 4 of 4 — complete
- **Branch:** main
- **Last completed:** Commit 4 — basic CLI

## Stack

```
main
```

## Speedbumps

- Nix flakes only include tracked files, so `flake.nix` had to be staged before generating `flake.lock`.

## Learnings

- Run project tooling through `nix develop -c`.
- Bucket search ranges overlap at their boundaries, keeping all three choices usable for very small lists.
- Catalog ranking sessions save only on completion, so an interrupted re-rank leaves the previous persisted order intact.
- Replacing a category ranking is one SQLite transaction; validation happens before the existing order is deleted.
- The CLI stores data under the XDG data directory by default and supports `RANK_IT_DB` for explicit locations and isolated tests.
