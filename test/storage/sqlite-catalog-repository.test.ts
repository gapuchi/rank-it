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
  it("persists ordered items across reopen", async () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const user = await repository.createUser("tester");
    await repository.saveRanking(user.id, "movies", [
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    await repository.close();

    const reopened = new SqliteCatalogRepository(path);
    expect(await reopened.getRankedItems(user.id, "movies")).toEqual([
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    await reopened.close();
  });

  it("keeps category rankings independent when replacing an order", async () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const user = await repository.createUser("tester");
    await repository.saveRanking(user.id, "movies", [
      item("movie-a", "movies"),
      item("movie-b", "movies"),
    ]);
    await repository.saveRanking(user.id, "video-games", [
      item("game-a", "video-games"),
      item("game-b", "video-games"),
    ]);

    await repository.saveRanking(user.id, "movies", [
      item("movie-b", "movies"),
      item("movie-a", "movies"),
    ]);

    expect(
      (await repository.getRankedItems(user.id, "movies")).map(({ id }) => id),
    ).toEqual(["movie-b", "movie-a"]);
    expect(
      (await repository.getRankedItems(user.id, "video-games")).map(
        ({ id }) => id,
      ),
    ).toEqual(["game-a", "game-b"]);
    await repository.close();
  });

  it("keeps user rankings independent", async () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const alice = await repository.createUser("alice");
    const bob = await repository.createUser("bob");
    await repository.saveRanking(alice.id, "movies", [item("a", "movies")]);
    await repository.saveRanking(bob.id, "movies", [item("b", "movies")]);

    expect(await repository.getRankedItems(alice.id, "movies")).toEqual([
      item("a", "movies"),
    ]);
    expect(await repository.getRankedItems(bob.id, "movies")).toEqual([
      item("b", "movies"),
    ]);
    await repository.close();
  });

  it("rejects invalid rankings before replacing persisted data", async () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const user = await repository.createUser("tester");
    await repository.saveRanking(user.id, "movies", [item("movie-a", "movies")]);

    await expect(
      repository.saveRanking(user.id, "movies", [
        item("game-a", "video-games"),
      ]),
    ).rejects.toThrow("another category");
    expect(await repository.getRankedItems(user.id, "movies")).toEqual([
      item("movie-a", "movies"),
    ]);
    await repository.close();
  });

  it("migrates legacy v1 databases to the default user", async () => {
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
    const defaultUser = await repository.findUserByName("default");
    expect(defaultUser).toBeDefined();
    expect(await repository.getRankedItems(defaultUser!.id, "movies")).toEqual([
      item("legacy-item", "movies", "Legacy"),
    ]);
    await repository.close();
  });

  it("persists the database entry that confirmed an item", async () => {
    const path = temporaryDatabasePath();
    const repository = new SqliteCatalogRepository(path);
    const user = await repository.createUser("tester");

    await repository.saveRanking(user.id, "movies", [
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
        source: "tmdb",
        sourceId: "329865",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    await repository.close();

    const reopened = new SqliteCatalogRepository(path);
    expect(await reopened.getRankedItems(user.id, "movies")).toEqual([
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
        source: "tmdb",
        sourceId: "329865",
      },
      item("moonlight", "movies", "Moonlight"),
    ]);
    await reopened.close();
  });

  it("adds source columns when migrating from schema v3", async () => {
    const path = temporaryDatabasePath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE
      );
      INSERT INTO users (id, name) VALUES ('user-1', 'tester');
      CREATE TABLE ranked_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL CHECK (
          category IN ('movies', 'tv-shows', 'video-games')
        ),
        title TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position > 0),
        UNIQUE (user_id, category, position)
      );
      INSERT INTO ranked_items (id, user_id, category, title, position)
      VALUES ('arrival', 'user-1', 'movies', 'Arrival', 1);
    `);
    legacy.pragma("user_version = 3");
    legacy.close();

    const repository = new SqliteCatalogRepository(path);
    expect(await repository.getRankedItems("user-1", "movies")).toEqual([
      item("arrival", "movies", "Arrival"),
    ]);

    await repository.saveRanking("user-1", "movies", [
      {
        id: "arrival",
        category: "movies",
        title: "Arrival",
        source: "tmdb",
        sourceId: "329865",
      },
    ]);
    expect(
      (await repository.getRankedItems("user-1", "movies"))[0],
    ).toMatchObject({ source: "tmdb", sourceId: "329865" });
    await repository.close();
  });
});
