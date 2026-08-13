import type { CatalogRepository } from "../core/catalog-repository.js";
import type { Category, Item, RankedItem } from "../core/types.js";
import { apiRequest, type HttpClientOptions } from "./client.js";

export class HttpCatalogRepository implements CatalogRepository {
  readonly #options: HttpClientOptions;

  constructor(options: HttpClientOptions = {}) {
    this.#options = options;
  }

  async getRankedItems(
    userId: string,
    category: Category,
  ): Promise<readonly Item[]> {
    const response = await apiRequest<{ readonly items: readonly RankedItem[] }>(
      `/users/${userId}/categories/${category}/items`,
      {},
      this.#options,
    );
    return response.items.map(
      ({ id, category: itemCategory, title, source, sourceId }) => ({
        id,
        category: itemCategory,
        title,
        ...(source === undefined || sourceId === undefined
          ? {}
          : { source, sourceId }),
      }),
    );
  }

  async saveRanking(
    userId: string,
    category: Category,
    items: readonly Item[],
  ): Promise<void> {
    await apiRequest(
      `/users/${userId}/categories/${category}/ranking`,
      {
        method: "PUT",
        body: JSON.stringify({ items }),
      },
      this.#options,
    );
  }

  async close(): Promise<void> {}
}
