import { describe, expect, it } from "vitest";

import type { CatalogRepository } from "../../src/core/catalog-repository.js";
import { CatalogService } from "../../src/core/catalog-service.js";
import {
  categories,
  type Category,
  type Item,
} from "../../src/core/types.js";

class MemoryCatalogRepository implements CatalogRepository {
  readonly #rankings = new Map<Category, Item[]>(
    categories.map((category) => [category, []]),
  );

  getRankedItems(category: Category): readonly Item[] {
    return [...(this.#rankings.get(category) ?? [])];
  }

  saveRanking(category: Category, items: readonly Item[]): void {
    if (items.some((item) => item.category !== category)) {
      throw new Error("Cannot save an item under another category");
    }
    this.#rankings.set(category, [...items]);
  }

  seed(category: Category, items: readonly Item[]): void {
    this.saveRanking(category, items);
  }

  close(): void {}
}

function item(id: string, category: Category = "movies"): Item {
  return { id, category, title: id.toUpperCase() };
}

function createService(repository: CatalogRepository): CatalogService {
  let nextId = 1;
  return new CatalogService(repository, () => `new-${nextId++}`);
}

describe("CatalogService", () => {
  it("persists the first item as soon as its session completes", () => {
    const repository = new MemoryCatalogRepository();
    const service = createService(repository);

    const session = service.addItem({
      category: "video-games",
      title: "  Outer Wilds  ",
      year: 2019,
      notes: "  Explore freely.  ",
    });

    expect(session.next()).toMatchObject({ type: "done" });
    expect(repository.getRankedItems("video-games")).toEqual([
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
    const repository = new MemoryCatalogRepository();
    repository.seed("movies", [item("best"), item("worst")]);
    const service = createService(repository);
    const session = service.addItem({ category: "movies", title: "Middle" });

    expect(session.answer({ bucket: "okay" })).toMatchObject({
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
      repository.getRankedItems("movies").map(({ id }) => id),
    ).toEqual(["best", "new-1", "worst"]);
  });

  it("lists items best-first with derived scores", () => {
    const repository = new MemoryCatalogRepository();
    repository.seed("tv-shows", [
      item("best", "tv-shows"),
      item("middle", "tv-shows"),
      item("worst", "tv-shows"),
    ]);
    const service = createService(repository);

    expect(
      service
        .list("tv-shows")
        .map(({ id, position, score }) => ({ id, position, score })),
    ).toEqual([
      { id: "best", position: 1, score: 10 },
      { id: "middle", position: 2, score: 5 },
      { id: "worst", position: 3, score: 0 },
    ]);
  });

  it("deletes an item while preserving the relative order", () => {
    const repository = new MemoryCatalogRepository();
    repository.seed("movies", [item("a"), item("b"), item("c")]);
    const service = createService(repository);

    service.delete("movies", "b");

    expect(
      repository.getRankedItems("movies").map(({ id }) => id),
    ).toEqual(["a", "c"]);
  });

  it("reranks an existing item without duplicating it", () => {
    const repository = new MemoryCatalogRepository();
    repository.seed("movies", [item("a"), item("b"), item("c")]);
    const service = createService(repository);
    const session = service.rerank("movies", "c");

    expect(session.answer({ bucket: "great" })).toMatchObject({
      type: "compare",
      against: item("a"),
    });
    expect(session.answer({ better: true })).toMatchObject({
      type: "done",
      item: { id: "c", position: 1 },
    });
    expect(
      repository.getRankedItems("movies").map(({ id }) => id),
    ).toEqual(["c", "a", "b"]);
  });

  it("rejects invalid input and missing items", () => {
    const repository = new MemoryCatalogRepository();
    const service = createService(repository);

    expect(() =>
      service.addItem({ category: "movies", title: "   " }),
    ).toThrow("Title is required");
    expect(() => service.delete("movies", "missing")).toThrow("was not found");
    expect(() => service.rerank("movies", "missing")).toThrow("was not found");
  });
});
