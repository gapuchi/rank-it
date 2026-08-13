import { describe, expect, it } from "vitest";

import type { CatalogRepository } from "../../src/core/catalog-repository.js";
import { CatalogService } from "../../src/core/catalog-service.js";
import type { MetadataProvider } from "../../src/core/metadata.js";
import {
  categories,
  type Category,
  type Item,
} from "../../src/core/types.js";
import {
  InMemoryCatalogRepository,
  InMemoryUserRepository,
} from "../../src/storage/in-memory-catalog-repository.js";
import { createFakeMetadataProvider } from "../support/fake-metadata-provider.js";

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
    this.#rankingsForUser(userId).set(category, [...items]);
  }

  async close(): Promise<void> {}

  async seed(
    userId: string,
    category: Category,
    items: readonly Item[],
  ): Promise<void> {
    await this.saveRanking(userId, category, items);
  }
}

function item(id: string, category: Category = "movies"): Item {
  return { id, category, title: id.toUpperCase() };
}

async function createFixture(
  repository: MemoryCatalogRepository = new MemoryCatalogRepository(),
  options: { metadataProvider?: MetadataProvider } = {},
) {
  let nextId = 1;
  const users = new InMemoryUserRepository();
  const user = await users.createUser("alice");
  const service = new CatalogService(
    repository,
    () => `new-${nextId++}`,
    options,
  );
  return { repository, service, users, userId: user.id };
}

function createSearchableFixture() {
  return createFixture(new MemoryCatalogRepository(), {
    metadataProvider: createFakeMetadataProvider(),
  });
}

describe("CatalogService metadata", () => {
  it("reports which categories can be confirmed against a database", async () => {
    const plain = await createFixture();
    expect(plain.service.supportsMetadata("movies")).toBe(false);

    const searchable = await createSearchableFixture();
    expect(searchable.service.supportsMetadata("movies")).toBe(true);
    expect(searchable.service.supportsMetadata("tv-shows")).toBe(true);
    expect(searchable.service.supportsMetadata("video-games")).toBe(false);
  });

  it("searches the title database without changing the catalog", async () => {
    const { repository, service, userId } = await createSearchableFixture();

    await expect(service.searchMetadata("movies", "arrival")).resolves.toEqual([
      expect.objectContaining({ sourceId: "1", title: "Arrival" }),
      expect.objectContaining({ sourceId: "2" }),
    ]);
    await expect(
      service.searchMetadata("movies", "arrival", { limit: 1 }),
    ).resolves.toHaveLength(1);
    await expect(repository.getRankedItems(userId, "movies")).resolves.toEqual(
      [],
    );
  });

  it("rejects searches that are unconfigured, unsupported, or empty", async () => {
    const plain = await createFixture();
    await expect(
      plain.service.searchMetadata("movies", "arrival"),
    ).rejects.toThrow("not configured");

    const { service } = await createSearchableFixture();
    await expect(service.searchMetadata("video-games", "halo")).rejects.toThrow(
      "not available for video-games",
    );
    await expect(service.searchMetadata("movies", "  ")).rejects.toThrow(
      "search query is required",
    );
  });

  it("adds a confirmed title using the database entry as the source of truth", async () => {
    const { repository, service, userId } = await createSearchableFixture();

    const session = await service.addMatchedItem({
      userId,
      category: "movies",
      source: "fake-db",
      sourceId: "1",
    });

    expect(session.next()).toMatchObject({ type: "done" });
    await expect(repository.getRankedItems(userId, "movies")).resolves.toEqual([
      {
        id: "new-1",
        category: "movies",
        title: "Arrival",
        source: "fake-db",
        sourceId: "1",
      },
    ]);
  });

  it("refuses titles the database does not know", async () => {
    const { service, userId } = await createSearchableFixture();

    await expect(
      service.addMatchedItem({ userId, category: "movies", sourceId: "999" }),
    ).rejects.toThrow("was not found");
    await expect(
      service.addMatchedItem({
        userId,
        category: "movies",
        source: "imdb",
        sourceId: "1",
      }),
    ).rejects.toThrow('Unknown metadata source "imdb"');
  });

  it("resolves import titles to matches and reports the rest", async () => {
    const { service } = await createSearchableFixture();

    await expect(
      service.resolveTitles("movies", ["arrival", "an unknown film"]),
    ).resolves.toEqual({
      items: [{ title: "Arrival", source: "fake-db", sourceId: "1" }],
      unmatched: ["an unknown film"],
    });
  });

  it("requires both a source and source ID for confirmed items", async () => {
    const { service, userId } = await createFixture();

    await expect(
      service.addItem({
        userId,
        category: "movies",
        title: "Arrival",
        sourceId: "1",
      }),
    ).rejects.toThrow("both a metadata source and source ID");
  });

  it("keeps provenance when importing confirmed items", async () => {
    const { repository, service, userId } = await createSearchableFixture();
    const session = await service.importUnordered({
      userId,
      category: "movies",
      items: [{ title: "Arrival", source: "fake-db", sourceId: "1" }],
    });

    expect(session.next()).toMatchObject({ type: "done" });
    await expect(repository.getRankedItems(userId, "movies")).resolves.toEqual([
      {
        id: "new-1",
        category: "movies",
        title: "Arrival",
        source: "fake-db",
        sourceId: "1",
      },
    ]);
  });
});

describe("CatalogService", () => {
  it("persists the first item as soon as its session completes", async () => {
    const { repository, service, userId } = await createFixture();

    const session = await service.addItem({
      userId,
      category: "video-games",
      title: "  Outer Wilds  ",
    });

    expect(session.next()).toMatchObject({ type: "done" });
    expect(await repository.getRankedItems(userId, "video-games")).toEqual([
      {
        id: "new-1",
        category: "video-games",
        title: "Outer Wilds",
      },
    ]);
  });

  it("persists an item in the position chosen by comparisons", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [item("best"), item("worst")]);
    const session = await service.addItem({
      userId,
      category: "movies",
      title: "Middle",
    });

    expect(session.next()).toMatchObject({
      type: "compare",
      against: item("worst"),
    });
    expect(await session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: item("best"),
    });
    expect(await session.answer({ better: false })).toMatchObject({
      type: "done",
      item: { position: 2 },
    });
    expect(
      (await repository.getRankedItems(userId, "movies")).map(({ id }) => id),
    ).toEqual(["best", "new-1", "worst"]);
  });

  it("bulk-ranks unordered titles and persists each completed item", async () => {
    const { repository, service, userId } = await createFixture();
    const session = await service.importUnordered({
      userId,
      category: "movies",
      titles: ["Arrival", "Moonlight", "Parasite"],
    });

    expect(session.next()).toMatchObject({
      type: "compare",
      item: { title: "Moonlight" },
      against: { title: "Arrival" },
      current: 2,
      total: 3,
    });
    expect(
      (await repository.getRankedItems(userId, "movies")).map(
        ({ title }) => title,
      ),
    ).toEqual(["Arrival"]);

    expect(await session.answer({ better: false })).toMatchObject({
      type: "compare",
      item: { title: "Parasite" },
      against: { title: "Moonlight" },
      current: 3,
      total: 3,
    });
    expect(
      (await repository.getRankedItems(userId, "movies")).map(
        ({ title }) => title,
      ),
    ).toEqual(["Arrival", "Moonlight"]);

    expect(await session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: { title: "Arrival" },
    });
    expect(await session.answer({ better: false })).toEqual({
      type: "done",
      imported: 3,
      total: 3,
    });
    expect(
      (await repository.getRankedItems(userId, "movies")).map(
        ({ title }) => title,
      ),
    ).toEqual(["Arrival", "Parasite", "Moonlight"]);
  });

  it("appends imports to an existing ranking by default", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [item("best"), item("worst")]);

    const session = await service.importUnordered({
      userId,
      category: "movies",
      titles: ["Middle"],
    });
    expect(session.next()).toMatchObject({
      type: "compare",
      against: item("worst"),
    });
    await session.answer({ better: true });
    expect(await session.answer({ better: false })).toEqual({
      type: "done",
      imported: 1,
      total: 1,
    });
    expect(
      (await repository.getRankedItems(userId, "movies")).map(({ id }) => id),
    ).toEqual(["best", "new-1", "worst"]);
  });

  it("ignores exact duplicate titles within and before an append import", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [
      { id: "existing", category: "movies", title: "Arrival" },
    ]);

    const session = await service.importUnordered({
      userId,
      category: "movies",
      titles: [" Arrival ", "Moonlight", "Moonlight", "moonlight"],
    });

    expect(session.next()).toMatchObject({
      type: "compare",
      item: { id: "new-1", title: "Moonlight" },
      total: 2,
    });
    await session.answer({ better: false });
    await session.answer({ better: false });
    expect(session.next()).toEqual({
      type: "done",
      imported: 2,
      total: 2,
    });
    expect(
      (await repository.getRankedItems(userId, "movies")).map(
        ({ title }) => title,
      ),
    ).toEqual(["Arrival", "Moonlight", "moonlight"]);
  });

  it("completes without comparisons when every appended title is a duplicate", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [
      { id: "existing", category: "movies", title: "Arrival" },
    ]);

    const session = await service.importUnordered({
      userId,
      category: "movies",
      titles: ["Arrival", " Arrival "],
    });

    expect(session.next()).toEqual({
      type: "done",
      imported: 0,
      total: 0,
    });
    expect(await repository.getRankedItems(userId, "movies")).toEqual([
      { id: "existing", category: "movies", title: "Arrival" },
    ]);
  });

  it("replaces an existing ranking when requested", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [item("existing")]);

    const session = await service.importUnordered({
      userId,
      category: "movies",
      titles: ["Replacement"],
      mode: "replace",
    });

    expect(session.next()).toEqual({
      type: "done",
      imported: 1,
      total: 1,
    });
    expect(await repository.getRankedItems(userId, "movies")).toEqual([
      { id: "new-1", category: "movies", title: "Replacement" },
    ]);
  });

  it("deduplicates replacement imports without considering old titles", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [
      { id: "existing", category: "movies", title: "Arrival" },
    ]);

    const session = await service.importUnordered({
      userId,
      category: "movies",
      titles: ["Arrival", "Arrival"],
      mode: "replace",
    });

    expect(session.next()).toEqual({
      type: "done",
      imported: 1,
      total: 1,
    });
    expect(await repository.getRankedItems(userId, "movies")).toEqual([
      { id: "new-1", category: "movies", title: "Arrival" },
    ]);
  });

  it("lists items best-first with derived scores", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "tv-shows", [
      item("best", "tv-shows"),
      item("middle", "tv-shows"),
      item("worst", "tv-shows"),
    ]);

    expect(
      (await service.list(userId, "tv-shows")).map(
        ({ id, position, score }) => ({ id, position, score }),
      ),
    ).toEqual([
      { id: "best", position: 1, score: 10 },
      { id: "middle", position: 2, score: 5 },
      { id: "worst", position: 3, score: 0 },
    ]);
  });

  it("keeps rankings isolated per user", async () => {
    const repository = new MemoryCatalogRepository();
    const users = new InMemoryUserRepository();
    const alice = await users.createUser("alice");
    const bob = await users.createUser("bob");
    let nextId = 1;
    const service = new CatalogService(repository, () => `new-${nextId++}`);

    expect(
      (
        await service.addItem({
          userId: alice.id,
          category: "movies",
          title: "A",
        })
      ).next(),
    ).toMatchObject({ type: "done" });
    expect(
      (
        await service.addItem({
          userId: bob.id,
          category: "movies",
          title: "B",
        })
      ).next(),
    ).toMatchObject({ type: "done" });

    expect(
      (await service.list(alice.id, "movies")).map(({ title }) => title),
    ).toEqual(["A"]);
    expect(
      (await service.list(bob.id, "movies")).map(({ title }) => title),
    ).toEqual(["B"]);
  });

  it("deletes an item while preserving the relative order", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [
      item("a"),
      item("b"),
      item("c"),
    ]);

    await service.delete(userId, "movies", "b");

    expect(
      (await repository.getRankedItems(userId, "movies")).map(({ id }) => id),
    ).toEqual(["a", "c"]);
  });

  it("reranks an existing item without duplicating it", async () => {
    const { repository, service, userId } = await createFixture();
    await repository.seed(userId, "movies", [
      item("a"),
      item("b"),
      item("c"),
    ]);
    const session = await service.rerank(userId, "movies", "c");

    expect(session.next()).toMatchObject({
      type: "compare",
      against: item("b"),
    });
    expect(await session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: item("a"),
    });
    expect(await session.answer({ better: true })).toMatchObject({
      type: "done",
      item: { id: "c", position: 1 },
    });
    expect(
      (await repository.getRankedItems(userId, "movies")).map(({ id }) => id),
    ).toEqual(["c", "a", "b"]);
  });

  it("rejects invalid input and missing items", async () => {
    const { service, userId } = await createFixture();

    await expect(
      service.addItem({ userId, category: "movies", title: "   " }),
    ).rejects.toThrow("Title is required");
    await expect(service.delete(userId, "movies", "missing")).rejects.toThrow(
      "was not found",
    );
    await expect(service.rerank(userId, "movies", "missing")).rejects.toThrow(
      "was not found",
    );
    await expect(
      service.importUnordered({
        userId,
        category: "movies",
        titles: [],
      }),
    ).rejects.toThrow("At least one title");
    await expect(
      service.importUnordered({
        userId,
        category: "movies",
        titles: ["Valid", "  "],
      }),
    ).rejects.toThrow("cannot be empty");
  });
});
