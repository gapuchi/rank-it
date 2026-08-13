import type { Category, Item } from "./types.js";

export interface CatalogRepository {
  getRankedItems(
    userId: string,
    category: Category,
  ): Promise<readonly Item[]>;
  saveRanking(
    userId: string,
    category: Category,
    items: readonly Item[],
  ): Promise<void>;
  close(): Promise<void>;
}
