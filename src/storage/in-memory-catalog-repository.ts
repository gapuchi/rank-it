import type { CatalogRepository } from "../core/catalog-repository.js";
import { categories, type Category, type Item } from "../core/types.js";

export class InMemoryCatalogRepository implements CatalogRepository {
  readonly #rankings = new Map<Category, Item[]>(
    categories.map((category) => [category, []]),
  );

  getRankedItems(category: Category): readonly Item[] {
    return [...(this.#rankings.get(category) ?? [])];
  }

  saveRanking(category: Category, items: readonly Item[]): void {
    if (items.some((item) => item.category !== category)) {
      throw new Error("Cannot save an item under another category");
    }
    if (new Set(items.map(({ id }) => id)).size !== items.length) {
      throw new Error("A ranking cannot contain duplicate item IDs");
    }

    this.#rankings.set(category, [...items]);
  }

  close(): void {}
}
