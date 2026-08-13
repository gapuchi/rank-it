import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createApiServer } from "../../src/api/server.js";
import {
  fetchMetadataCapabilities,
  HttpMetadataProvider,
} from "../../src/http/http-metadata-provider.js";
import {
  InMemoryCatalogRepository,
  InMemoryUserRepository,
} from "../../src/storage/in-memory-catalog-repository.js";
import { createFakeMetadataProvider } from "../support/fake-metadata-provider.js";

const servers: Array<() => Promise<void>> = [];

/**
 * Runs the provider against the real API server so the browser transport and
 * its server routes are checked together.
 */
async function startServer(searchable = true): Promise<string> {
  const server = createApiServer({
    catalogRepository: new InMemoryCatalogRepository(),
    userRepository: new InMemoryUserRepository(),
    ...(searchable ? { metadataProvider: createFakeMetadataProvider() } : {}),
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/api`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
});

describe("HttpMetadataProvider", () => {
  it("reads capabilities from the server", async () => {
    const baseUrl = await startServer();

    await expect(fetchMetadataCapabilities({ baseUrl })).resolves.toEqual({
      name: "fake-db",
      searchableCategories: ["movies", "tv-shows"],
    });
  });

  it("reports no capabilities when the server has no provider", async () => {
    const baseUrl = await startServer(false);

    await expect(fetchMetadataCapabilities({ baseUrl })).resolves.toEqual({
      name: null,
      searchableCategories: [],
    });
  });

  it("searches and looks up titles over HTTP", async () => {
    const baseUrl = await startServer();
    const provider = new HttpMetadataProvider({
      baseUrl,
      name: "fake-db",
      searchableCategories: ["movies", "tv-shows"],
    });

    expect(provider.supports("movies")).toBe(true);
    expect(provider.supports("video-games")).toBe(false);

    await expect(
      provider.search("movies", "arrival", { limit: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({ title: "Arrival", sourceId: "1" }),
    ]);
    await expect(provider.lookup("movies", "1")).resolves.toMatchObject({
      title: "Arrival",
    });
  });

  it("treats an unknown title as no match rather than an error", async () => {
    const baseUrl = await startServer();
    const provider = new HttpMetadataProvider({
      baseUrl,
      searchableCategories: ["movies"],
    });

    await expect(provider.lookup("movies", "999")).resolves.toBeUndefined();
  });

  it("surfaces server failures other than a missing title", async () => {
    const baseUrl = await startServer(false);
    const provider = new HttpMetadataProvider({
      baseUrl,
      searchableCategories: ["movies"],
    });

    await expect(provider.search("movies", "arrival")).rejects.toThrow(
      "not configured",
    );
  });
});
