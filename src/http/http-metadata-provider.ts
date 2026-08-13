import type {
  Category,
  MetadataMatch,
  MetadataProvider,
  MetadataSearchOptions,
} from "../core/index.js";
import { apiRequest, HttpRequestError, type HttpClientOptions } from "./client.js";

export interface HttpMetadataProviderOptions extends HttpClientOptions {
  /**
   * Categories the server can confirm. `MetadataProvider.supports` is
   * synchronous, so capabilities are fetched once (see `fetchMetadataCapabilities`)
   * and handed to the provider.
   */
  readonly searchableCategories: readonly Category[];
  readonly name?: string;
}

export interface MetadataCapabilities {
  readonly name: string | null;
  readonly searchableCategories: readonly Category[];
}

/**
 * Reaches the title database through the rank-it server, which holds the API
 * key. Lets a browser client run the same `CatalogService` flow as the CLI.
 */
export class HttpMetadataProvider implements MetadataProvider {
  readonly name: string;
  readonly #searchable: readonly Category[];
  readonly #options: HttpClientOptions;

  constructor(options: HttpMetadataProviderOptions) {
    this.name = options.name ?? "remote";
    this.#searchable = options.searchableCategories;
    this.#options = options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl };
  }

  supports(category: Category): boolean {
    return this.#searchable.includes(category);
  }

  async search(
    category: Category,
    query: string,
    options?: MetadataSearchOptions,
  ): Promise<readonly MetadataMatch[]> {
    const params = new URLSearchParams({ category, query });
    if (options?.limit !== undefined) {
      params.set("limit", String(options.limit));
    }

    const response = await apiRequest<{
      readonly matches: readonly MetadataMatch[];
    }>(`/metadata/search?${params.toString()}`, {}, this.#options);
    return response.matches;
  }

  async lookup(
    category: Category,
    sourceId: string,
  ): Promise<MetadataMatch | undefined> {
    try {
      const response = await apiRequest<{ readonly match: MetadataMatch }>(
        `/metadata/${category}/titles/${encodeURIComponent(sourceId)}`,
        {},
        this.#options,
      );
      return response.match;
    } catch (error: unknown) {
      if (error instanceof HttpRequestError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }
}

/** Asks the server whether title search is available, and for what. */
export async function fetchMetadataCapabilities(
  options: HttpClientOptions = {},
): Promise<MetadataCapabilities> {
  const response = await apiRequest<{
    readonly name?: string | null;
    readonly searchableCategories?: readonly Category[];
  }>("/metadata/capabilities", {}, options);

  return {
    name: response.name ?? null,
    searchableCategories: response.searchableCategories ?? [],
  };
}
