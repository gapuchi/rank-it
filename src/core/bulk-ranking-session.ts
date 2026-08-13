import type { CatalogRepository } from "./catalog-repository.js";
import {
  RankingSession,
  type RankingAnswer,
  type RankingPrompt,
} from "./ranking-session.js";
import type { Category, Item } from "./types.js";

export type BulkRankingPrompt =
  | {
      readonly type: "compare";
      readonly item: Item;
      readonly against: Item;
      readonly current: number;
      readonly total: number;
    }
  | {
      readonly type: "done";
      readonly imported: number;
      readonly total: number;
    };

export class BulkRankingSession {
  readonly #repository: CatalogRepository;
  readonly #userId: string;
  readonly #category: Category;
  readonly #pendingItems: readonly Item[];
  #rankedItems: readonly Item[];
  #imported = 0;
  #session: RankingSession | undefined;
  #prompt: BulkRankingPrompt;

  private constructor(
    repository: CatalogRepository,
    userId: string,
    category: Category,
    items: readonly Item[],
    rankedItems: readonly Item[],
  ) {
    if (
      [...items, ...rankedItems].some((item) => item.category !== category)
    ) {
      throw new Error("All items in a bulk ranking session must share a category");
    }
    const itemIds = [...items, ...rankedItems].map(({ id }) => id);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new Error("A bulk ranking session cannot contain duplicate item IDs");
    }

    this.#repository = repository;
    this.#userId = userId;
    this.#category = category;
    this.#pendingItems = [...items];
    this.#rankedItems = [...rankedItems];
    this.#prompt = {
      type: "done",
      imported: 0,
      total: this.#pendingItems.length,
    };
  }

  static async create(
    repository: CatalogRepository,
    userId: string,
    category: Category,
    items: readonly Item[],
    rankedItems: readonly Item[],
  ): Promise<BulkRankingSession> {
    const session = new BulkRankingSession(
      repository,
      userId,
      category,
      items,
      rankedItems,
    );
    session.#prompt = await session.#startNextItem();
    return session;
  }

  next(): BulkRankingPrompt {
    return this.#prompt;
  }

  async answer(answer: RankingAnswer): Promise<BulkRankingPrompt> {
    if (this.#prompt.type === "done" || this.#session === undefined) {
      throw new Error("This bulk ranking session is already complete");
    }

    this.#prompt = await this.#handleRankingPrompt(
      this.#session.answer(answer),
    );
    return this.#prompt;
  }

  async #startNextItem(): Promise<BulkRankingPrompt> {
    const item = this.#pendingItems[this.#imported];
    if (item === undefined) {
      this.#session = undefined;
      return {
        type: "done",
        imported: this.#imported,
        total: this.#pendingItems.length,
      };
    }

    this.#session = new RankingSession(item, this.#rankedItems);
    return this.#handleRankingPrompt(this.#session.next());
  }

  async #handleRankingPrompt(
    prompt: RankingPrompt,
  ): Promise<BulkRankingPrompt> {
    if (prompt.type === "compare") {
      return {
        ...prompt,
        current: this.#imported + 1,
        total: this.#pendingItems.length,
      };
    }

    const { position: _, score: __, ...item } = prompt.item;
    const nextItems = [...this.#rankedItems];
    nextItems.splice(prompt.item.position - 1, 0, item);
    await this.#repository.saveRanking(
      this.#userId,
      this.#category,
      nextItems,
    );
    this.#rankedItems = nextItems;
    this.#imported += 1;
    return this.#startNextItem();
  }
}
