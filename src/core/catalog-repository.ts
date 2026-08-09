import type { Category, Item } from "./types.js";

export interface CatalogRepository {
  getRankedItems(category: Category): readonly Item[];
  saveRanking(category: Category, items: readonly Item[]): void;
}
