import { describe, expect, it } from "vitest";

import { createTmdbMetadataProvider } from "../../src/metadata/tmdb-metadata-provider.js";

interface StubResponse {
  readonly status?: number;
  readonly body?: unknown;
}

function createStubFetch(routes: Record<string, StubResponse>) {
  const calls: string[] = [];
  const fetchStub = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}?${url.searchParams.toString()}`);
    const route = routes[url.pathname];
    const status = route?.status ?? (route === undefined ? 404 : 200);
    return new Response(
      route?.body === undefined ? null : JSON.stringify(route.body),
      { status },
    );
  }) as typeof globalThis.fetch;

  return { fetchStub, calls };
}

describe("createTmdbMetadataProvider", () => {
  it("searches movies and maps results to matches", async () => {
    const { fetchStub, calls } = createStubFetch({
      "/3/search/movie": {
        body: {
          results: [
            {
              id: 329865,
              title: "Arrival",
              release_date: "2016-11-10",
              overview: "Linguist meets heptapods.",
              poster_path: "/poster.jpg",
            },
            { id: 1, title: "Untitled", release_date: "" },
          ],
        },
      },
    });

    const provider = createTmdbMetadataProvider({
      apiKey: "test-key",
      baseUrl: "https://tmdb.test/3",
      imageBaseUrl: "https://images.test/w200",
      fetch: fetchStub,
    });

    expect(provider.supports("movies")).toBe(true);
    expect(provider.supports("tv-shows")).toBe(true);
    expect(provider.supports("video-games")).toBe(false);

    const matches = await provider.search("movies", "arrival");
    expect(matches).toEqual([
      {
        source: "tmdb",
        sourceId: "329865",
        title: "Arrival",
        year: 2016,
        overview: "Linguist meets heptapods.",
        posterUrl: "https://images.test/w200/poster.jpg",
      },
      { source: "tmdb", sourceId: "1", title: "Untitled" },
    ]);
    expect(calls[0]).toContain("query=arrival");
    expect(calls[0]).toContain("api_key=test-key");
  });

  it("uses the tv endpoint and honours the result limit", async () => {
    const { fetchStub, calls } = createStubFetch({
      "/3/search/tv": {
        body: {
          results: [
            { id: 1, name: "Severance", first_air_date: "2022-02-18" },
            { id: 2, name: "Severed", first_air_date: "2010-01-01" },
          ],
        },
      },
    });

    const provider = createTmdbMetadataProvider({
      apiKey: "test-key",
      baseUrl: "https://tmdb.test/3",
      fetch: fetchStub,
    });

    const matches = await provider.search("tv-shows", "severance", {
      limit: 1,
    });
    expect(matches).toEqual([
      { source: "tmdb", sourceId: "1", title: "Severance", year: 2022 },
    ]);
    expect(calls[0]).toContain("/3/search/tv");
  });

  it("looks up a single entry and reports unknown ids as undefined", async () => {
    const { fetchStub } = createStubFetch({
      "/3/movie/329865": {
        body: { id: 329865, title: "Arrival", release_date: "2016-11-10" },
      },
    });

    const provider = createTmdbMetadataProvider({
      apiKey: "test-key",
      baseUrl: "https://tmdb.test/3",
      fetch: fetchStub,
    });

    expect(await provider.lookup("movies", "329865")).toEqual({
      source: "tmdb",
      sourceId: "329865",
      title: "Arrival",
      year: 2016,
    });
    expect(await provider.lookup("movies", "404404")).toBeUndefined();
    expect(await provider.lookup("movies", "not-an-id")).toBeUndefined();
  });

  it("sends bearer auth for v4 read tokens", async () => {
    let authorization: string | null = null;
    const fetchStub = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof globalThis.fetch;

    const provider = createTmdbMetadataProvider({
      apiKey: "header.payload.signature",
      baseUrl: "https://tmdb.test/3",
      fetch: fetchStub,
    });

    await provider.search("movies", "arrival");
    expect(authorization).toBe("Bearer header.payload.signature");
  });

  it("surfaces provider failures and unsupported categories", async () => {
    const { fetchStub } = createStubFetch({
      "/3/search/movie": { status: 500 },
    });

    const provider = createTmdbMetadataProvider({
      apiKey: "test-key",
      baseUrl: "https://tmdb.test/3",
      fetch: fetchStub,
    });

    await expect(provider.search("movies", "arrival")).rejects.toThrow(
      "status 500",
    );
    await expect(provider.search("video-games", "halo")).rejects.toThrow(
      "does not cover video-games",
    );
    expect(() => createTmdbMetadataProvider({ apiKey: " " })).toThrow(
      "TMDB API key is required",
    );
  });
});
