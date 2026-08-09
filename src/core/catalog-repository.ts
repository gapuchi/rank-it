import type { Category, Item } from "./types.js";

export interface CatalogRepository {
  getRankedItems(userId: string, category: Category): readonly Item[];
  saveRanking(
    userId: string,
    category: Category,
    items: readonly Item[],
  ): void;
  close(): void;
}
