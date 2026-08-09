import { describe, expect, it } from "vitest";

import type { Item } from "../../src/core/types.js";
import { InMemoryCatalogRepository } from "../../src/storage/in-memory-catalog-repository.js";

function item(
  id: string,
  category: Item["category"],
  title = id.toUpperCase(),
): Item {
  return { id, category, title };
}

describe("InMemoryCatalogRepository", () => {
  it("stores rankings per category independently", () => {
    const repository = new InMemoryCatalogRepository();
    repository.saveRanking("movies", [
      item("movie-a", "movies"),
      item("movie-b", "movies"),
    ]);
    repository.saveRanking("video-games", [item("game-a", "video-games")]);

    expect(repository.getRankedItems("movies").map(({ id }) => id)).toEqual([
      "movie-a",
      "movie-b",
    ]);
    expect(
      repository.getRankedItems("video-games").map(({ id }) => id),
    ).toEqual(["game-a"]);
  });

  it("returns copies so callers cannot mutate stored state", () => {
    const repository = new InMemoryCatalogRepository();
    repository.saveRanking("movies", [item("movie-a", "movies")]);

    const first = repository.getRankedItems("movies") as Item[];
    first.push(item("movie-b", "movies"));

    expect(repository.getRankedItems("movies").map(({ id }) => id)).toEqual([
      "movie-a",
    ]);
  });

  it("rejects mismatched categories and duplicate IDs", () => {
    const repository = new InMemoryCatalogRepository();

    expect(() =>
      repository.saveRanking("movies", [item("game-a", "video-games")]),
    ).toThrow("another category");
    expect(() =>
      repository.saveRanking("movies", [
        item("movie-a", "movies"),
        item("movie-a", "movies", "Duplicate"),
      ]),
    ).toThrow("duplicate item IDs");
  });
});
