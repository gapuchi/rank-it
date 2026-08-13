import type { CatalogRepository } from "./catalog-repository.js";
import { BulkRankingSession } from "./bulk-ranking-session.js";
import {
  RankingSession,
  type RankingAnswer,
  type RankingPrompt,
} from "./ranking-session.js";
import { scoreForPosition } from "./score.js";
import type { Category, Item, RankedItem } from "./types.js";

export interface AddItemInput {
  readonly userId: string;
  readonly category: Category;
  readonly title: string;
}

export interface ImportUnorderedInput {
  readonly userId: string;
  readonly category: Category;
  readonly titles: readonly string[];
  readonly mode?: "append" | "replace";
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

  constructor(repository: CatalogRepository, generateId: () => string) {
    this.#repository = repository;
    this.#generateId = generateId;
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
    if (input.titles.length === 0) {
      throw new Error("At least one title is required for import");
    }

    const titles = input.titles.map((title) => {
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        throw new Error("Imported titles cannot be empty");
      }
      return trimmed;
    });
    const rankedItems =
      input.mode === "replace"
        ? []
        : await this.#repository.getRankedItems(
            input.userId,
            input.category,
          );
    const knownTitles = new Set(rankedItems.map(({ title }) => title));
    const uniqueTitles = titles.filter((title) => {
      if (knownTitles.has(title)) {
        return false;
      }
      knownTitles.add(title);
      return true;
    });
    const items = uniqueTitles.map((title) => ({
      id: this.#generateId(),
      category: input.category,
      title,
    }));

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

    return {
      id: this.#generateId(),
      category: input.category,
      title,
    };
  }
}
