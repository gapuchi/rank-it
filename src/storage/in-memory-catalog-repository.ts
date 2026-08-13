import type { CatalogRepository } from "../core/catalog-repository.js";
import type { UserRepository } from "../core/user-repository.js";
import { categories, type Category, type Item } from "../core/types.js";

export class InMemoryCatalogRepository implements CatalogRepository {
  readonly #rankings = new Map<string, Map<Category, Item[]>>();

  #rankingsForUser(userId: string): Map<Category, Item[]> {
    let rankings = this.#rankings.get(userId);
    if (rankings === undefined) {
      rankings = new Map(categories.map((category) => [category, []]));
      this.#rankings.set(userId, rankings);
    }
    return rankings;
  }

  async getRankedItems(
    userId: string,
    category: Category,
  ): Promise<readonly Item[]> {
    return [...(this.#rankingsForUser(userId).get(category) ?? [])];
  }

  async saveRanking(
    userId: string,
    category: Category,
    items: readonly Item[],
  ): Promise<void> {
    if (items.some((item) => item.category !== category)) {
      throw new Error("Cannot save an item under another category");
    }
    if (new Set(items.map(({ id }) => id)).size !== items.length) {
      throw new Error("A ranking cannot contain duplicate item IDs");
    }

    this.#rankingsForUser(userId).set(category, [...items]);
  }

  async close(): Promise<void> {}
}

export class InMemoryUserRepository implements UserRepository {
  readonly #users = new Map<string, { id: string; name: string }>();
  readonly #names = new Map<string, string>();
  #nextId = 1;

  async listUsers(): Promise<readonly { id: string; name: string }[]> {
    return [...this.#users.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async createUser(name: string): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error("User name is required");
    }
    const normalized = trimmed.toLowerCase();
    if (this.#names.has(normalized)) {
      throw new Error(`User "${trimmed}" already exists`);
    }

    const user = { id: `user-${this.#nextId++}`, name: trimmed };
    this.#users.set(user.id, user);
    this.#names.set(normalized, user.id);
    return user;
  }

  async findUserByName(
    name: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const id = this.#names.get(name.trim().toLowerCase());
    return id === undefined ? undefined : this.#users.get(id);
  }

  async close(): Promise<void> {}
}
