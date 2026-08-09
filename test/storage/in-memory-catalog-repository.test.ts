import { describe, expect, it } from "vitest";

import type { Item } from "../../src/core/types.js";
import {
  InMemoryCatalogRepository,
  InMemoryUserRepository,
} from "../../src/storage/in-memory-catalog-repository.js";

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
    const userId = "user-1";
    repository.saveRanking(userId, "movies", [
      item("movie-a", "movies"),
      item("movie-b", "movies"),
    ]);
    repository.saveRanking(userId, "video-games", [item("game-a", "video-games")]);

    expect(
      repository.getRankedItems(userId, "movies").map(({ id }) => id),
    ).toEqual(["movie-a", "movie-b"]);
    expect(
      repository.getRankedItems(userId, "video-games").map(({ id }) => id),
    ).toEqual(["game-a"]);
  });

  it("returns copies so callers cannot mutate stored state", () => {
    const repository = new InMemoryCatalogRepository();
    const userId = "user-1";
    repository.saveRanking(userId, "movies", [item("movie-a", "movies")]);

    const first = repository.getRankedItems(userId, "movies") as Item[];
    first.push(item("movie-b", "movies"));

    expect(
      repository.getRankedItems(userId, "movies").map(({ id }) => id),
    ).toEqual(["movie-a"]);
  });

  it("rejects mismatched categories and duplicate IDs", () => {
    const repository = new InMemoryCatalogRepository();
    const userId = "user-1";

    expect(() =>
      repository.saveRanking(userId, "movies", [item("game-a", "video-games")]),
    ).toThrow("another category");
    expect(() =>
      repository.saveRanking(userId, "movies", [
        item("movie-a", "movies"),
        item("movie-a", "movies", "Duplicate"),
      ]),
    ).toThrow("duplicate item IDs");
  });
});

describe("InMemoryUserRepository", () => {
  it("creates and finds users by case-insensitive name", () => {
    const repository = new InMemoryUserRepository();
    const user = repository.createUser("Alice");

    expect(repository.findUserByName("alice")).toEqual(user);
    expect(repository.listUsers()).toEqual([user]);
    expect(() => repository.createUser("alice")).toThrow("already exists");
  });
});
