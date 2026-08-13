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
  it("stores rankings per category independently", async () => {
    const repository = new InMemoryCatalogRepository();
    const userId = "user-1";
    await repository.saveRanking(userId, "movies", [
      item("movie-a", "movies"),
      item("movie-b", "movies"),
    ]);
    await repository.saveRanking(userId, "video-games", [
      item("game-a", "video-games"),
    ]);

    expect(
      (await repository.getRankedItems(userId, "movies")).map(({ id }) => id),
    ).toEqual(["movie-a", "movie-b"]);
    expect(
      (await repository.getRankedItems(userId, "video-games")).map(
        ({ id }) => id,
      ),
    ).toEqual(["game-a"]);
  });

  it("returns copies so callers cannot mutate stored state", async () => {
    const repository = new InMemoryCatalogRepository();
    const userId = "user-1";
    await repository.saveRanking(userId, "movies", [item("movie-a", "movies")]);

    const first = (await repository.getRankedItems(
      userId,
      "movies",
    )) as Item[];
    first.push(item("movie-b", "movies"));

    expect(
      (await repository.getRankedItems(userId, "movies")).map(({ id }) => id),
    ).toEqual(["movie-a"]);
  });

  it("rejects mismatched categories and duplicate IDs", async () => {
    const repository = new InMemoryCatalogRepository();
    const userId = "user-1";

    await expect(
      repository.saveRanking(userId, "movies", [item("game-a", "video-games")]),
    ).rejects.toThrow("another category");
    await expect(
      repository.saveRanking(userId, "movies", [
        item("movie-a", "movies"),
        item("movie-a", "movies", "Duplicate"),
      ]),
    ).rejects.toThrow("duplicate item IDs");
  });
});

describe("InMemoryUserRepository", () => {
  it("creates and finds users by case-insensitive name", async () => {
    const repository = new InMemoryUserRepository();
    const user = await repository.createUser("Alice");

    expect(await repository.findUserByName("alice")).toEqual(user);
    expect(await repository.listUsers()).toEqual([user]);
    await expect(repository.createUser("alice")).rejects.toThrow(
      "already exists",
    );
  });
});
