import type { CatalogRepository } from "./catalog-repository.js";
import { BulkRankingSession } from "./bulk-ranking-session.js";
import {
  RankingSession,
  type RankingAnswer,
  type RankingPrompt,
} from "./ranking-session.js";
import type {
  MetadataMatch,
  MetadataProvider,
  MetadataSearchOptions,
} from "./metadata.js";
import { scoreForPosition } from "./score.js";
import type { Category, Item, RankedItem } from "./types.js";

export interface ItemInput {
  readonly title: string;
  readonly source?: string;
  readonly sourceId?: string;
}

export interface AddItemInput extends ItemInput {
  readonly userId: string;
  readonly category: Category;
}

export interface AddMatchedItemInput {
  readonly userId: string;
  readonly category: Category;
  readonly sourceId: string;
  readonly source?: string;
}

export interface ImportUnorderedInput {
  readonly userId: string;
  readonly category: Category;
  readonly titles?: readonly string[];
  readonly items?: readonly ItemInput[];
  readonly mode?: "append" | "replace";
}

export interface CatalogServiceOptions {
  readonly metadataProvider?: MetadataProvider;
}

export interface ResolvedTitles {
  readonly items: readonly ItemInput[];
  readonly unmatched: readonly string[];
}

export class CatalogRankingSession {
  readonly #repository: CatalogRepository;
  readonly #userId: string;
  readonly #category: Category;
  readonly #originalItems: readonly Item[];
  readonly #session: RankingSession;
  #saved = false;

  private constructor(
    repository: CatalogRepository,
    userId: string,
    item: Item,
    rankedItems: readonly Item[],
  ) {
    this.#repository = repository;
    this.#userId = userId;
    this.#category = item.category;
    this.#originalItems = [...rankedItems];
    this.#session = new RankingSession(item, rankedItems);
  }

  static async create(
    repository: CatalogRepository,
    userId: string,
    item: Item,
    rankedItems: readonly Item[],
  ): Promise<CatalogRankingSession> {
    const session = new CatalogRankingSession(
      repository,
      userId,
      item,
      rankedItems,
    );
    await session.#saveIfComplete(session.#session.next());
    return session;
  }

  next(): RankingPrompt {
    return this.#session.next();
  }

  async answer(answer: RankingAnswer): Promise<RankingPrompt> {
    const prompt = this.#session.answer(answer);
    await this.#saveIfComplete(prompt);
    return prompt;
  }

  async #saveIfComplete(prompt: RankingPrompt): Promise<void> {
    if (prompt.type !== "done" || this.#saved) {
      return;
    }

    const { position: _, score: __, ...item } = prompt.item;
    const nextItems = [...this.#originalItems];
    nextItems.splice(prompt.item.position - 1, 0, item);
    await this.#repository.saveRanking(
      this.#userId,
      this.#category,
      nextItems,
    );
    this.#saved = true;
  }
}

export class CatalogService {
  readonly #repository: CatalogRepository;
  readonly #generateId: () => string;
  readonly #metadataProvider: MetadataProvider | undefined;

  constructor(
    repository: CatalogRepository,
    generateId: () => string,
    options: CatalogServiceOptions = {},
  ) {
    this.#repository = repository;
    this.#generateId = generateId;
    this.#metadataProvider = options.metadataProvider;
  }

  /** True when titles in this category can be confirmed against a database. */
  supportsMetadata(category: Category): boolean {
    return this.#metadataProvider?.supports(category) ?? false;
  }

  /** Searches the configured title database without touching the catalog. */
  async searchMetadata(
    category: Category,
    query: string,
    options?: MetadataSearchOptions,
  ): Promise<readonly MetadataMatch[]> {
    const provider = this.#requireProvider(category);
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      throw new Error("A search query is required");
    }

    return provider.search(category, trimmed, options ?? {});
  }

  /**
   * Adds an item from a confirmed database entry. The entry is looked up again
   * here so a caller cannot introduce a title the provider does not know.
   */
  async addMatchedItem(
    input: AddMatchedItemInput,
  ): Promise<CatalogRankingSession> {
    const match = await this.#lookupMatch(
      input.category,
      input.sourceId,
      input.source,
    );

    return this.addItem({
      userId: input.userId,
      category: input.category,
      title: match.title,
      source: match.source,
      sourceId: match.sourceId,
    });
  }

  /**
   * Resolves free-text titles (such as a CSV import) to their best database
   * match, reporting titles the provider does not recognize.
   */
  async resolveTitles(
    category: Category,
    titles: readonly string[],
  ): Promise<ResolvedTitles> {
    const provider = this.#requireProvider(category);
    const items: ItemInput[] = [];
    const unmatched: string[] = [];

    for (const title of titles) {
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        throw new Error("Imported titles cannot be empty");
      }

      const [match] = await provider.search(category, trimmed, { limit: 1 });
      if (match === undefined) {
        unmatched.push(trimmed);
        continue;
      }

      items.push({
        title: match.title,
        source: match.source,
        sourceId: match.sourceId,
      });
    }

    return { items, unmatched };
  }

  async addItem(input: AddItemInput): Promise<CatalogRankingSession> {
    const item = this.#buildItem(input);
    const rankedItems = await this.#repository.getRankedItems(
      input.userId,
      input.category,
    );
    return CatalogRankingSession.create(
      this.#repository,
      input.userId,
      item,
      rankedItems,
    );
  }

  async importUnordered(
    input: ImportUnorderedInput,
  ): Promise<BulkRankingSession> {
    const rows = normalizeImportRows(input);
    if (rows.length === 0) {
      throw new Error("At least one title is required for import");
    }

    const normalizedRows = rows.map((row) => {
      const title = row.title.trim();
      if (title.length === 0) {
        throw new Error("Imported titles cannot be empty");
      }
      return { ...row, title };
    });
    const rankedItems =
      input.mode === "replace"
        ? []
        : await this.#repository.getRankedItems(
            input.userId,
            input.category,
          );
    const knownTitles = new Set(rankedItems.map(({ title }) => title));
    const items = normalizedRows.flatMap((row) => {
      if (knownTitles.has(row.title)) {
        return [];
      }
      knownTitles.add(row.title);
      return [
        this.#buildItem({
          ...row,
          userId: input.userId,
          category: input.category,
        }),
      ];
    });

    return BulkRankingSession.create(
      this.#repository,
      input.userId,
      input.category,
      items,
      rankedItems,
    );
  }

  async list(
    userId: string,
    category: Category,
  ): Promise<readonly RankedItem[]> {
    const items = await this.#repository.getRankedItems(userId, category);
    return items.map((item, index) => ({
      ...item,
      position: index + 1,
      score: scoreForPosition(index + 1, items.length),
    }));
  }

  async delete(
    userId: string,
    category: Category,
    itemId: string,
  ): Promise<void> {
    const items = await this.#repository.getRankedItems(userId, category);
    const remainingItems = items.filter(({ id }) => id !== itemId);
    if (remainingItems.length === items.length) {
      throw new Error(`Item "${itemId}" was not found in ${category}`);
    }

    await this.#repository.saveRanking(userId, category, remainingItems);
  }

  async rerank(
    userId: string,
    category: Category,
    itemId: string,
  ): Promise<CatalogRankingSession> {
    const items = await this.#repository.getRankedItems(userId, category);
    const item = items.find(({ id }) => id === itemId);
    if (item === undefined) {
      throw new Error(`Item "${itemId}" was not found in ${category}`);
    }

    const otherItems = items.filter(({ id }) => id !== itemId);
    return CatalogRankingSession.create(
      this.#repository,
      userId,
      item,
      otherItems,
    );
  }

  #buildItem(input: AddItemInput): Item {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error("Title is required");
    }
    if ((input.source === undefined) !== (input.sourceId === undefined)) {
      throw new Error(
        "A confirmed title needs both a metadata source and source ID",
      );
    }

    return {
      id: this.#generateId(),
      category: input.category,
      title,
      ...(input.source === undefined || input.sourceId === undefined
        ? {}
        : { source: input.source, sourceId: input.sourceId }),
    };
  }

  #requireProvider(category: Category): MetadataProvider {
    const provider = this.#metadataProvider;
    if (provider === undefined) {
      throw new Error("Title search is not configured");
    }
    if (!provider.supports(category)) {
      throw new Error(`Title search is not available for ${category}`);
    }
    return provider;
  }

  async #lookupMatch(
    category: Category,
    sourceId: string,
    source: string | undefined,
  ): Promise<MetadataMatch> {
    const provider = this.#requireProvider(category);
    if (source !== undefined && source !== provider.name) {
      throw new Error(`Unknown metadata source "${source}"`);
    }

    const match = await provider.lookup(category, sourceId);
    if (match === undefined) {
      throw new Error(
        `Title "${sourceId}" was not found in the ${provider.name} database`,
      );
    }
    return match;
  }
}

function normalizeImportRows(input: ImportUnorderedInput): readonly ItemInput[] {
  if (input.items !== undefined) {
    return input.items;
  }
  if (input.titles !== undefined) {
    return input.titles.map((title) => ({ title }));
  }
  return [];
}
