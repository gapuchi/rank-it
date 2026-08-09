import type { CatalogRepository } from "./catalog-repository.js";
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

export class CatalogRankingSession {
  readonly #repository: CatalogRepository;
  readonly #userId: string;
  readonly #category: Category;
  readonly #originalItems: readonly Item[];
  readonly #session: RankingSession;
  #saved = false;

  constructor(
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
    this.#saveIfComplete(this.#session.next());
  }

  next(): RankingPrompt {
    return this.#session.next();
  }

  answer(answer: RankingAnswer): RankingPrompt {
    const prompt = this.#session.answer(answer);
    this.#saveIfComplete(prompt);
    return prompt;
  }

  #saveIfComplete(prompt: RankingPrompt): void {
    if (prompt.type !== "done" || this.#saved) {
      return;
    }

    const { position: _, score: __, ...item } = prompt.item;
    const nextItems = [...this.#originalItems];
    nextItems.splice(prompt.item.position - 1, 0, item);
    this.#repository.saveRanking(this.#userId, this.#category, nextItems);
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

  addItem(input: AddItemInput): CatalogRankingSession {
    const item = this.#buildItem(input);
    const rankedItems = this.#repository.getRankedItems(
      input.userId,
      input.category,
    );
    return new CatalogRankingSession(
      this.#repository,
      input.userId,
      item,
      rankedItems,
    );
  }

  list(userId: string, category: Category): readonly RankedItem[] {
    const items = this.#repository.getRankedItems(userId, category);
    return items.map((item, index) => ({
      ...item,
      position: index + 1,
      score: scoreForPosition(index + 1, items.length),
    }));
  }

  delete(userId: string, category: Category, itemId: string): void {
    const items = this.#repository.getRankedItems(userId, category);
    const remainingItems = items.filter(({ id }) => id !== itemId);
    if (remainingItems.length === items.length) {
      throw new Error(`Item "${itemId}" was not found in ${category}`);
    }

    this.#repository.saveRanking(userId, category, remainingItems);
  }

  rerank(
    userId: string,
    category: Category,
    itemId: string,
  ): CatalogRankingSession {
    const items = this.#repository.getRankedItems(userId, category);
    const item = items.find(({ id }) => id === itemId);
    if (item === undefined) {
      throw new Error(`Item "${itemId}" was not found in ${category}`);
    }

    const otherItems = items.filter(({ id }) => id !== itemId);
    return new CatalogRankingSession(
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
