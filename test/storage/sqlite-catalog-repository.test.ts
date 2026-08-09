import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Item } from "../../src/core/types.js";
import { SqliteCatalogRepository } from "../../src/storage/sqlite-catalog-repository.js";

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "rank-it-"));
  temporaryDirectories.push(directory);
  return join(directory, "rank-it.db");
}

function item(
  id: string,
  category: Item["category"],
  title = id.toUpperCase(),
): Item {
  return { id, category, title };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqliteCatalogRepository", () => {
  it("persists ordered items and metadata across reopen", () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    repository.saveRanking("movies", [
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
        year: 2016,
        notes: "First contact.",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    repository.close();

    const reopened = new SqliteCatalogRepository(path);
    expect(reopened.getRankedItems("movies")).toEqual([
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
        year: 2016,
        notes: "First contact.",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    reopened.close();
  });

  it("keeps category rankings independent when replacing an order", () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    repository.saveRanking("movies", [
      item("movie-a", "movies"),
      item("movie-b", "movies"),
    ]);
    repository.saveRanking("video-games", [
      item("game-a", "video-games"),
      item("game-b", "video-games"),
    ]);

    repository.saveRanking("movies", [
      item("movie-b", "movies"),
      item("movie-a", "movies"),
    ]);

    expect(
      repository.getRankedItems("movies").map(({ id }) => id),
    ).toEqual(["movie-b", "movie-a"]);
    expect(
      repository.getRankedItems("video-games").map(({ id }) => id),
    ).toEqual(["game-a", "game-b"]);
    repository.close();
  });

  it("rejects invalid rankings before replacing persisted data", () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    repository.saveRanking("movies", [item("movie-a", "movies")]);

    expect(() =>
      repository.saveRanking("movies", [item("game-a", "video-games")]),
    ).toThrow("another category");
    expect(repository.getRankedItems("movies")).toEqual([
      item("movie-a", "movies"),
    ]);
    repository.close();
  });
});
