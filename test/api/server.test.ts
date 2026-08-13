import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  InMemoryCatalogRepository,
  InMemoryUserRepository,
} from "../../src/storage/in-memory-catalog-repository.js";
import { createApiServer } from "../../src/api/server.js";

interface Harness {
  readonly userId: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  json(path: string, init?: RequestInit): Promise<any>;
  close(): Promise<void>;
}

const harnesses: Harness[] = [];
const temporaryDirectories: string[] = [];

async function startServer(webRoot?: string): Promise<Harness> {
  const catalogRepository = new InMemoryCatalogRepository();
  const userRepository = new InMemoryUserRepository();
  const user = await userRepository.createUser("default");

  const server = createApiServer({
    catalogRepository,
    userRepository,
    ...(webRoot === undefined ? {} : { webRoot }),
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const harness: Harness = {
    userId: user.id,
    request: (path, init) => fetch(`${base}${path}`, init),
    async json(path, init) {
      const response = await fetch(`${base}${path}`, init);
      return response.json();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };

  harnesses.push(harness);
  return harness;
}

function postJson(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function putJson(body: unknown): RequestInit {
  return {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("API server", () => {
  it("reports health and available categories", async () => {
    const api = await startServer();

    expect(await api.json("/api/health")).toEqual({ status: "ok" });
    expect(await api.json("/api/categories")).toEqual({
      categories: ["movies", "tv-shows", "video-games"],
    });
  });

  it("serves the built web app without masking unknown API routes", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "rank-it-web-"));
    temporaryDirectories.push(webRoot);
    await writeFile(join(webRoot, "index.html"), "<h1>rank-it</h1>");
    const api = await startServer(webRoot);

    const page = await api.request("/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toBe("<h1>rank-it</h1>");

    const spaRoute = await api.request("/rankings/movies");
    expect(spaRoute.status).toBe(200);
    expect(await spaRoute.text()).toBe("<h1>rank-it</h1>");

    const missingApi = await api.request("/api/missing");
    expect(missingApi.status).toBe(404);
    expect(await missingApi.json()).toEqual({ error: "Not found" });
  });

  it("lists and creates users", async () => {
    const api = await startServer();

    const listed = await api.json("/api/users");
    expect(listed.users).toEqual([{ id: api.userId, name: "default" }]);

    const created = await api.request("/api/users", postJson({ name: "sam" }));
    expect(created.status).toBe(201);
    expect((await created.json()).user).toMatchObject({ name: "sam" });

    const duplicate = await api.request("/api/users", postJson({ name: "sam" }));
    expect(duplicate.status).toBe(400);
  });

  it("loads and saves rankings through the repository endpoints", async () => {
    const api = await startServer();
    const items = `/api/users/${api.userId}/categories/movies/items`;
    const ranking = `/api/users/${api.userId}/categories/movies/ranking`;

    const empty = await api.json(items);
    expect(empty.items).toEqual([]);

    const save = await api.request(
      ranking,
      putJson({
        items: [{ id: "item-1", category: "movies", title: "Arrival" }],
      }),
    );
    expect(save.status).toBe(204);

    const list = await api.json(items);
    expect(list.items).toEqual([
      {
        id: "item-1",
        category: "movies",
        title: "Arrival",
        position: 1,
        score: 10,
      },
    ]);
  });

  it("keeps each user's ranking separate", async () => {
    const api = await startServer();
    const other = (await api.json("/api/users", postJson({ name: "sam" })))
      .user;
    const ranking = `/api/users/${api.userId}/categories/movies/ranking`;

    await api.request(
      ranking,
      putJson({
        items: [{ id: "item-1", category: "movies", title: "Arrival" }],
      }),
    );

    const otherList = await api.json(
      `/api/users/${other.id}/categories/movies/items`,
    );
    expect(otherList.items).toEqual([]);

    const ownList = await api.json(
      `/api/users/${api.userId}/categories/movies/items`,
    );
    expect(ownList.items).toHaveLength(1);
  });

  it("deletes items", async () => {
    const api = await startServer();
    const items = `/api/users/${api.userId}/categories/video-games/items`;
    const ranking = `/api/users/${api.userId}/categories/video-games/ranking`;

    await api.request(
      ranking,
      putJson({
        items: [
          { id: "item-1", category: "video-games", title: "Outer Wilds" },
          { id: "item-2", category: "video-games", title: "Disco Elysium" },
        ],
      }),
    );

    const deleteResponse = await api.request(`${items}/item-1`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(204);

    const list = await api.json(items);
    expect(list.items.map((item: { id: string }) => item.id)).toEqual([
      "item-2",
    ]);
  });

  it("returns useful client errors", async () => {
    const api = await startServer();

    const badCategory = await api.request(
      `/api/users/${api.userId}/categories/books/items`,
    );
    expect(badCategory.status).toBe(400);

    const unknownUser = await api.request(
      "/api/users/nobody/categories/movies/items",
    );
    expect(unknownUser.status).toBe(404);

    const missingItems = await api.request(
      `/api/users/${api.userId}/categories/movies/ranking`,
      putJson({}),
    );
    expect(missingItems.status).toBe(400);

    const missingItem = await api.request(
      `/api/users/${api.userId}/categories/movies/items/nope`,
      { method: "DELETE" },
    );
    expect(missingItem.status).toBe(404);
  });
});
