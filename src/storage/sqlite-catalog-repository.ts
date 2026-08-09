import Database from "better-sqlite3";

import type { CatalogRepository } from "../core/catalog-repository.js";
import {
  parseCategory,
  type Category,
  type Item,
} from "../core/types.js";

interface ItemRow {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly year: number | null;
  readonly notes: string | null;
}

const schemaVersion = 1;

export class SqliteCatalogRepository implements CatalogRepository {
  readonly #database: Database.Database;

  constructor(filename: string) {
    this.#database = new Database(filename);
    this.#database.pragma("foreign_keys = ON");
    this.#migrate();
  }

  getRankedItems(category: Category): readonly Item[] {
    const rows = this.#database
      .prepare(
        `SELECT id, category, title, year, notes
         FROM ranked_items
         WHERE category = ?
         ORDER BY position ASC`,
      )
      .all(category) as ItemRow[];

    return rows.map((row) => ({
      id: row.id,
      category: parseCategory(row.category),
      title: row.title,
      ...(row.year === null ? {} : { year: row.year }),
      ...(row.notes === null ? {} : { notes: row.notes }),
    }));
  }

  saveRanking(category: Category, items: readonly Item[]): void {
    if (items.some((item) => item.category !== category)) {
      throw new Error("Cannot save an item under another category");
    }
    if (new Set(items.map(({ id }) => id)).size !== items.length) {
      throw new Error("A ranking cannot contain duplicate item IDs");
    }

    const replaceRanking = this.#database.transaction(() => {
      this.#database
        .prepare("DELETE FROM ranked_items WHERE category = ?")
        .run(category);
      const insert = this.#database.prepare(
        `INSERT INTO ranked_items
           (id, category, title, year, notes, position)
         VALUES
           (@id, @category, @title, @year, @notes, @position)`,
      );

      items.forEach((item, index) => {
        insert.run({
          id: item.id,
          category: item.category,
          title: item.title,
          year: item.year ?? null,
          notes: item.notes ?? null,
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
      this.#database.pragma(`user_version = ${schemaVersion}`);
    })();
  }
}
