import { describe, expect, it } from "vitest";

import {
  BulkRankingSession,
  estimateBulkComparisons,
} from "../../src/core/bulk-ranking-session.js";
import type { CatalogRepository } from "../../src/core/catalog-repository.js";
import type { Category, Item } from "../../src/core/types.js";

class MemoryCatalogRepository implements CatalogRepository {
  readonly rankings = new Map<string, Item[]>();
  #saves = 0;

  get saves(): number {
    return this.#saves;
  }

  getRankedItems(userId: string, category: Category): readonly Item[] {
    return this.rankings.get(`${userId}:${category}`) ?? [];
  }

  saveRanking(userId: string, category: Category, items: readonly Item[]): void {
    this.#saves += 1;
    this.rankings.set(
      `${userId}:${category}`,
      items.map((item) => ({ ...item })),
    );
  }

  close(): void {}
}

function item(id: string, title = id): Item {
  return { id, category: "movies", title };
}

function rankAll(
  session: BulkRankingSession,
  decide: (left: Item, right: Item) => boolean,
): number {
  let prompt = session.next();
  let comparisons = 0;
  while (prompt.type === "compare") {
    comparisons += 1;
    prompt = session.answer({
      better: decide(prompt.item, prompt.against),
    });
  }
  return comparisons;
}

describe("BulkRankingSession", () => {
  it("merge-sorts unordered imports and saves once at the end", () => {
    const repository = new MemoryCatalogRepository();
    const session = new BulkRankingSession(
      repository,
      "user-1",
      "movies",
      [item("a", "Arrival"), item("m", "Moonlight"), item("p", "Parasite")],
      [],
    );

    expect(session.next()).toMatchObject({
      type: "compare",
      item: { title: "Arrival" },
      against: { title: "Moonlight" },
      current: 1,
    });
    expect(repository.saves).toBe(0);

    // Arrival > Moonlight
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      item: { title: "Arrival" },
      against: { title: "Parasite" },
    });
    // Arrival > Parasite, then Moonlight vs Parasite
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      item: { title: "Moonlight" },
      against: { title: "Parasite" },
    });
    expect(session.answer({ better: false })).toEqual({
      type: "done",
      imported: 3,
      total: 3,
    });

    expect(repository.saves).toBe(1);
    expect(
      repository.getRankedItems("user-1", "movies").map(({ title }) => title),
    ).toEqual(["Arrival", "Parasite", "Moonlight"]);
  });

  it("merges a sorted import into an existing ranking without reordering it", () => {
    const repository = new MemoryCatalogRepository();
    const existing = [item("best"), item("worst")];
    const session = new BulkRankingSession(
      repository,
      "user-1",
      "movies",
      [item("middle")],
      existing,
    );

    expect(session.next()).toMatchObject({
      type: "compare",
      item: { id: "best" },
      against: { id: "middle" },
    });
    // existing best > middle
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      item: { id: "worst" },
      against: { id: "middle" },
    });
    // middle > existing worst
    expect(session.answer({ better: false })).toEqual({
      type: "done",
      imported: 1,
      total: 1,
    });

    expect(
      repository.getRankedItems("user-1", "movies").map(({ id }) => id),
    ).toEqual(["best", "middle", "worst"]);
    expect(existing.map(({ id }) => id)).toEqual(["best", "worst"]);
  });

  it("keeps comparison counts within the merge-sort bound for large imports", () => {
    const repository = new MemoryCatalogRepository();
    const pending = Array.from({ length: 64 }, (_, index) =>
      item(`item-${index}`, `Title ${index}`),
    );
    const session = new BulkRankingSession(
      repository,
      "user-1",
      "movies",
      pending,
      [],
    );

    const preferredOrder = new Map(
      pending.map((entry, index) => [entry.id, index]),
    );
    const comparisons = rankAll(
      session,
      (left, right) =>
        (preferredOrder.get(left.id) ?? 0) < (preferredOrder.get(right.id) ?? 0),
    );

    const bound = estimateBulkComparisons(pending.length, 0);
    expect(comparisons).toBeLessThanOrEqual(bound);
    expect(comparisons).toBeLessThanOrEqual(64 * 6);
    expect(repository.saves).toBe(1);
    expect(
      repository.getRankedItems("user-1", "movies").map(({ id }) => id),
    ).toEqual(pending.map(({ id }) => id));
  });

  it("rejects mixed categories and duplicate ids", () => {
    const repository = new MemoryCatalogRepository();
    expect(
      () =>
        new BulkRankingSession(
          repository,
          "user-1",
          "movies",
          [item("a"), { ...item("b"), category: "tv-shows" }],
          [],
        ),
    ).toThrow("must share a category");
    expect(
      () =>
        new BulkRankingSession(
          repository,
          "user-1",
          "movies",
          [item("a"), item("a")],
          [],
        ),
    ).toThrow("duplicate item IDs");
  });
});

describe("estimateBulkComparisons", () => {
  it("matches the bottom-up merge-sort upper bound", () => {
    expect(estimateBulkComparisons(1, 0)).toBe(0);
    expect(estimateBulkComparisons(2, 0)).toBe(1);
    expect(estimateBulkComparisons(3, 0)).toBe(3);
    expect(estimateBulkComparisons(4, 0)).toBe(5);
    expect(estimateBulkComparisons(2, 2)).toBe(1 + 2 + 2 - 1);
  });
});
