import { describe, expect, it } from "vitest";

import type { CatalogRepository } from "../../src/core/catalog-repository.js";
import { CatalogService } from "../../src/core/catalog-service.js";
import {
  categories,
  type Category,
  type Item,
} from "../../src/core/types.js";
import {
  InMemoryCatalogRepository,
  InMemoryUserRepository,
} from "../../src/storage/in-memory-catalog-repository.js";

class MemoryCatalogRepository implements CatalogRepository {
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
    this.#rankingsForUser(userId).set(category, [...items]);
  }

  close(): void {}

  seed(userId: string, category: Category, items: readonly Item[]): void {
    this.saveRanking(userId, category, items);
  }
}

function item(id: string, category: Category = "movies"): Item {
  return { id, category, title: id.toUpperCase() };
}

function createFixture(repository: MemoryCatalogRepository = new MemoryCatalogRepository()) {
  let nextId = 1;
  const users = new InMemoryUserRepository();
  const user = users.createUser("alice");
  const service = new CatalogService(repository, () => `new-${nextId++}`);
  return { repository, service, users, userId: user.id };
}

describe("CatalogService", () => {
  it("persists the first item as soon as its session completes", () => {
    const { repository, service, userId } = createFixture();

    const session = service.addItem({
      userId,
      category: "video-games",
      title: "  Outer Wilds  ",
      year: 2019,
      notes: "  Explore freely.  ",
    });

    expect(session.next()).toMatchObject({ type: "done" });
    expect(repository.getRankedItems(userId, "video-games")).toEqual([
      {
        id: "new-1",
        category: "video-games",
        title: "Outer Wilds",
        year: 2019,
        notes: "Explore freely.",
      },
    ]);
  });

  it("persists an item in the position chosen by comparisons", () => {
    const { repository, service, userId } = createFixture();
    repository.seed(userId, "movies", [item("best"), item("worst")]);
    const session = service.addItem({
      userId,
      category: "movies",
      title: "Middle",
    });

    expect(session.next()).toMatchObject({
      type: "compare",
      against: item("worst"),
    });
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: item("best"),
    });
    expect(session.answer({ better: false })).toMatchObject({
      type: "done",
      item: { position: 2 },
    });
    expect(
      repository.getRankedItems(userId, "movies").map(({ id }) => id),
    ).toEqual(["best", "new-1", "worst"]);
  });

  it("lists items best-first with derived scores", () => {
    const { repository, service, userId } = createFixture();
    repository.seed(userId, "tv-shows", [
      item("best", "tv-shows"),
      item("middle", "tv-shows"),
      item("worst", "tv-shows"),
    ]);

    expect(
      service
        .list(userId, "tv-shows")
        .map(({ id, position, score }) => ({ id, position, score })),
    ).toEqual([
      { id: "best", position: 1, score: 10 },
      { id: "middle", position: 2, score: 5 },
      { id: "worst", position: 3, score: 0 },
    ]);
  });

  it("keeps rankings isolated per user", () => {
    const repository = new MemoryCatalogRepository();
    const users = new InMemoryUserRepository();
    const alice = users.createUser("alice");
    const bob = users.createUser("bob");
    let nextId = 1;
    const service = new CatalogService(repository, () => `new-${nextId++}`);

    expect(
      service.addItem({ userId: alice.id, category: "movies", title: "A" }).next(),
    ).toMatchObject({ type: "done" });
    expect(
      service.addItem({ userId: bob.id, category: "movies", title: "B" }).next(),
    ).toMatchObject({ type: "done" });

    expect(service.list(alice.id, "movies").map(({ title }) => title)).toEqual([
      "A",
    ]);
    expect(service.list(bob.id, "movies").map(({ title }) => title)).toEqual([
      "B",
    ]);
  });

  it("deletes an item while preserving the relative order", () => {
    const { repository, service, userId } = createFixture();
    repository.seed(userId, "movies", [item("a"), item("b"), item("c")]);

    service.delete(userId, "movies", "b");

    expect(
      repository.getRankedItems(userId, "movies").map(({ id }) => id),
    ).toEqual(["a", "c"]);
  });

  it("reranks an existing item without duplicating it", () => {
    const { repository, service, userId } = createFixture();
    repository.seed(userId, "movies", [item("a"), item("b"), item("c")]);
    const session = service.rerank(userId, "movies", "c");

    expect(session.next()).toMatchObject({
      type: "compare",
      against: item("b"),
    });
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: item("a"),
    });
    expect(session.answer({ better: true })).toMatchObject({
      type: "done",
      item: { id: "c", position: 1 },
    });
    expect(
      repository.getRankedItems(userId, "movies").map(({ id }) => id),
    ).toEqual(["c", "a", "b"]);
  });

  it("rejects invalid input and missing items", () => {
    const { repository, service, userId } = createFixture();

    expect(() =>
      service.addItem({ userId, category: "movies", title: "   " }),
    ).toThrow("Title is required");
    expect(() => service.delete(userId, "movies", "missing")).toThrow(
      "was not found",
    );
    expect(() => service.rerank(userId, "movies", "missing")).toThrow(
      "was not found",
    );
  });
});
