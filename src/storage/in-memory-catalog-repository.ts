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

  getRankedItems(userId: string, category: Category): readonly Item[] {
    return [...(this.#rankingsForUser(userId).get(category) ?? [])];
  }

  saveRanking(
    userId: string,
    category: Category,
    items: readonly Item[],
  ): void {
    if (items.some((item) => item.category !== category)) {
      throw new Error("Cannot save an item under another category");
    }
    if (new Set(items.map(({ id }) => id)).size !== items.length) {
      throw new Error("A ranking cannot contain duplicate item IDs");
    }

    this.#rankingsForUser(userId).set(category, [...items]);
  }

  close(): void {}
}

export class InMemoryUserRepository implements UserRepository {
  readonly #users = new Map<string, { id: string; name: string }>();
  readonly #names = new Map<string, string>();
  #nextId = 1;

  listUsers(): readonly { id: string; name: string }[] {
    return [...this.#users.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  createUser(name: string): { id: string; name: string } {
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

  findUserByName(name: string): { id: string; name: string } | undefined {
    const id = this.#names.get(name.trim().toLowerCase());
    return id === undefined ? undefined : this.#users.get(id);
  }

  close(): void {}
}
