import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import Database from "better-sqlite3";

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
  it("persists ordered items across reopen", () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const user = repository.createUser("tester");
    repository.saveRanking(user.id, "movies", [
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    repository.close();

    const reopened = new SqliteCatalogRepository(path);
    expect(reopened.getRankedItems(user.id, "movies")).toEqual([
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    reopened.close();
  });

  it("keeps category rankings independent when replacing an order", () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const user = repository.createUser("tester");
    repository.saveRanking(user.id, "movies", [
      item("movie-a", "movies"),
      item("movie-b", "movies"),
    ]);
    repository.saveRanking(user.id, "video-games", [
      item("game-a", "video-games"),
      item("game-b", "video-games"),
    ]);

    repository.saveRanking(user.id, "movies", [
      item("movie-b", "movies"),
      item("movie-a", "movies"),
    ]);

    expect(
      repository.getRankedItems(user.id, "movies").map(({ id }) => id),
    ).toEqual(["movie-b", "movie-a"]);
    expect(
      repository.getRankedItems(user.id, "video-games").map(({ id }) => id),
    ).toEqual(["game-a", "game-b"]);
    repository.close();
  });

  it("keeps user rankings independent", () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const alice = repository.createUser("alice");
    const bob = repository.createUser("bob");
    repository.saveRanking(alice.id, "movies", [item("a", "movies")]);
    repository.saveRanking(bob.id, "movies", [item("b", "movies")]);

    expect(repository.getRankedItems(alice.id, "movies")).toEqual([
      item("a", "movies"),
    ]);
    expect(repository.getRankedItems(bob.id, "movies")).toEqual([
      item("b", "movies"),
    ]);
    repository.close();
  });

  it("rejects invalid rankings before replacing persisted data", () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const user = repository.createUser("tester");
    repository.saveRanking(user.id, "movies", [item("movie-a", "movies")]);

    expect(() =>
      repository.saveRanking(user.id, "movies", [
        item("game-a", "video-games"),
      ]),
    ).toThrow("another category");
    expect(repository.getRankedItems(user.id, "movies")).toEqual([
      item("movie-a", "movies"),
    ]);
    repository.close();
  });

  it("migrates legacy v1 databases to the default user", () => {
    const path = temporaryDatabasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE ranked_items (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK (
          category IN ('movies', 'tv-shows', 'video-games')
        ),
        title TEXT NOT NULL,
        year INTEGER,
        notes TEXT,
        position INTEGER NOT NULL CHECK (position > 0),
        UNIQUE (category, position)
      );
      INSERT INTO ranked_items (id, category, title, year, notes, position)
      VALUES ('legacy-item', 'movies', 'Legacy', NULL, NULL, 1);
    `);
    legacy.pragma("user_version = 1");
    legacy.close();

    const repository = new SqliteCatalogRepository(path);
    const defaultUser = repository.findUserByName("default");
    expect(defaultUser).toBeDefined();
    expect(repository.getRankedItems(defaultUser!.id, "movies")).toEqual([
      item("legacy-item", "movies", "Legacy"),
    ]);
    repository.close();
  });
});
