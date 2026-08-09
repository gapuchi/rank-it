import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type { CatalogRepository } from "../core/catalog-repository.js";
import type { UserRepository } from "../core/user-repository.js";
import {
  parseCategory,
  type Category,
  type Item,
  type User,
} from "../core/types.js";

interface ItemRow {
  readonly id: string;
  readonly category: string;
  readonly title: string;
}

interface UserRow {
  readonly id: string;
  readonly name: string;
}

const schemaVersion = 3;

export class SqliteCatalogRepository implements CatalogRepository, UserRepository {
  readonly #database: Database.Database;

  constructor(filename: string) {
    this.#database = new Database(filename);
    this.#database.pragma("foreign_keys = ON");
    this.#migrate();
  }

  listUsers(): readonly User[] {
    const rows = this.#database
      .prepare("SELECT id, name FROM users ORDER BY name COLLATE NOCASE ASC")
      .all() as UserRow[];
    return rows;
  }

  createUser(name: string): User {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error("User name is required");
    }

    const existing = this.findUserByName(trimmed);
    if (existing !== undefined) {
      throw new Error(`User "${trimmed}" already exists`);
    }

    const user = { id: randomUUID(), name: trimmed };
    this.#database
      .prepare("INSERT INTO users (id, name) VALUES (@id, @name)")
      .run(user);
    return user;
  }

  findUserByName(name: string): User | undefined {
    const row = this.#database
      .prepare(
        "SELECT id, name FROM users WHERE name = ? COLLATE NOCASE LIMIT 1",
      )
      .get(name.trim()) as UserRow | undefined;
    return row;
  }

  getRankedItems(userId: string, category: Category): readonly Item[] {
    const rows = this.#database
      .prepare(
        `SELECT id, category, title
         FROM ranked_items
         WHERE user_id = ? AND category = ?
         ORDER BY position ASC`,
      )
      .all(userId, category) as ItemRow[];

    return rows.map((row) => ({
      id: row.id,
      category: parseCategory(row.category),
      title: row.title,
    }));
  }

  saveRanking(
    userId: string,
    category: Category,
    items: readonly Item[],
  ): void {
    if (items.some((item) => item.category !== category)) {
      throw new Error("Cannot save an item under another category");
    }
    if (new Set(items.map(({ id }) => id)).size !== items.length) {
      throw new Error("A ranking cannot contain duplicate item IDs");
    }

    const replaceRanking = this.#database.transaction(() => {
      this.#database
        .prepare("DELETE FROM ranked_items WHERE user_id = ? AND category = ?")
        .run(userId, category);
      const insert = this.#database.prepare(
        `INSERT INTO ranked_items
           (id, user_id, category, title, position)
         VALUES
           (@id, @userId, @category, @title, @position)`,
      );

      items.forEach((item, index) => {
        insert.run({
          id: item.id,
          userId,
          category: item.category,
          title: item.title,
          position: index + 1,
        });
      });
    });

    replaceRanking();
  }

  close(): void {
    this.#database.close();
  }

  #migrate(): void {
    const currentVersion = this.#database.pragma("user_version", {
      simple: true,
    }) as number;

    if (currentVersion > schemaVersion) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than supported version ${schemaVersion}`,
      );
    }
    if (currentVersion === schemaVersion) {
      return;
    }

    this.#database.transaction(() => {
      if (currentVersion < 1) {
        this.#database.exec(`
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
        `);
      }

      if (currentVersion < 2) {
        this.#database.exec(`
          CREATE TABLE users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE UNIQUE
          );

          INSERT INTO users (id, name) VALUES ('legacy-default', 'default');

          CREATE TABLE ranked_items_v2 (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category TEXT NOT NULL CHECK (
              category IN ('movies', 'tv-shows', 'video-games')
            ),
            title TEXT NOT NULL,
            year INTEGER,
            notes TEXT,
            position INTEGER NOT NULL CHECK (position > 0),
            UNIQUE (user_id, category, position)
          );

          INSERT INTO ranked_items_v2
            (id, user_id, category, title, year, notes, position)
          SELECT
            id, 'legacy-default', category, title, year, notes, position
          FROM ranked_items;

          DROP TABLE ranked_items;
          ALTER TABLE ranked_items_v2 RENAME TO ranked_items;
        `);
      }

      if (currentVersion < 3) {
        this.#database.exec(`
          CREATE TABLE ranked_items_v3 (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category TEXT NOT NULL CHECK (
              category IN ('movies', 'tv-shows', 'video-games')
            ),
            title TEXT NOT NULL,
            position INTEGER NOT NULL CHECK (position > 0),
            UNIQUE (user_id, category, position)
          );

          INSERT INTO ranked_items_v3
            (id, user_id, category, title, position)
          SELECT
            id, user_id, category, title, position
          FROM ranked_items;

          DROP TABLE ranked_items;
          ALTER TABLE ranked_items_v3 RENAME TO ranked_items;
        `);
      }

      this.#database.pragma(`user_version = ${schemaVersion}`);
    })();
  }
}
