import type { Category } from "./types.js";

/**
 * One confirmed entry in an external title database, used to prove that an
 * item exists before it enters a catalog. Fields beyond the identity of the
 * entry (year, overview, poster) are for display only and are not persisted.
 */
export interface MetadataMatch {
  readonly source: string;
  readonly sourceId: string;
  readonly title: string;
  readonly year?: number;
  readonly overview?: string;
  readonly posterUrl?: string;
}

export interface MetadataSearchOptions {
  readonly limit?: number;
}

/**
 * Port for an external title database. Implementations live outside `core`
 * because they perform network I/O.
 */
export interface MetadataProvider {
  /** Stable identifier persisted with matched items, such as `tmdb`. */
  readonly name: string;
  supports(category: Category): boolean;
  search(
    category: Category,
    query: string,
    options?: MetadataSearchOptions,
  ): Promise<readonly MetadataMatch[]>;
  lookup(
    category: Category,
    sourceId: string,
  ): Promise<MetadataMatch | undefined>;
}
