import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

import { getRequestListener } from "@hono/node-server";
import { Hono, type Context } from "hono";

import {
  CatalogService,
  categories,
  parseCategory,
  type Category,
  type CatalogRepository,
  type Item,
  type UserRepository,
} from "../core/index.js";

export interface ApiServerOptions {
  readonly catalogRepository: CatalogRepository;
  readonly userRepository: UserRepository;
  readonly generateId?: () => string;
  /** Absolute path to a directory of static web assets to serve. */
  readonly webRoot?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

interface Handlers {
  readonly service: CatalogService;
  readonly catalog: CatalogRepository;
  readonly users: UserRepository;
  readonly webRoot: string | undefined;
}

export function createApiServer(options: ApiServerOptions): Server {
  const generateId = options.generateId ?? randomUUID;
  const handlers: Handlers = {
    service: new CatalogService(options.catalogRepository, generateId),
    catalog: options.catalogRepository,
    users: options.userRepository,
    webRoot: options.webRoot === undefined ? undefined : resolve(options.webRoot),
  };

  const app = buildApp(handlers);
  return createServer(getRequestListener(app.fetch));
}

function buildApp(handlers: Handlers): Hono {
  const { service, catalog, users } = handlers;
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.get("/api/categories", (c) => c.json({ categories }));

  app.get("/api/users", async (c) =>
    c.json({ users: await users.listUsers() }),
  );

  app.post("/api/users", async (c) => {
    const body = await readJson(c);
    const name = body["name"];
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new HttpError(400, "A user name is required");
    }
    const user = await runCatch(() => users.createUser(name));
    return c.json({ user }, 201);
  });

  const categoryPath = "/api/users/:userId/categories/:category";
  const itemsPath = `${categoryPath}/items`;

  app.get(itemsPath, async (c) => {
    const userId = await requireUser(users, c.req.param("userId"));
    const category = validateCategory(c.req.param("category"));
    return c.json({ items: await service.list(userId, category) });
  });

  app.put(`${categoryPath}/ranking`, async (c) => {
    const userId = await requireUser(users, c.req.param("userId"));
    const category = validateCategory(c.req.param("category"));
    const items = await readRankingItems(c, category);
    await runCatch(() => catalog.saveRanking(userId, category, items));
    return c.body(null, 204);
  });

  app.delete(`${itemsPath}/:id`, async (c) => {
    const userId = await requireUser(users, c.req.param("userId"));
    const category = validateCategory(c.req.param("category"));
    await runCatch(() =>
      service.delete(userId, category, c.req.param("id")),
    );
    return c.body(null, 204);
  });

  // Unknown API routes must not fall through to the static handler.
  app.all("/api/*", () => {
    throw new HttpError(404, "Not found");
  });

  if (handlers.webRoot !== undefined) {
    const webRoot = handlers.webRoot;
    app.get("*", (c) => serveStatic(c.req.path, webRoot));
  }

  app.notFound(() => jsonResponse(404, { error: "Not found" }));
  app.onError((error) => respondToError(error));

  return app;
}

async function readRankingItems(
  c: Context,
  category: Category,
): Promise<readonly Item[]> {
  const body = await readJson(c);
  const rawItems = body["items"];
  if (!Array.isArray(rawItems)) {
    throw new HttpError(400, "Ranking must include an items array");
  }

  const items: Item[] = [];
  for (const rawItem of rawItems) {
    if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) {
      throw new HttpError(400, "Each ranked item must be an object");
    }

    const record = rawItem as Record<string, unknown>;
    const id = record["id"];
    const itemCategory = record["category"];
    const title = record["title"];
    if (typeof id !== "string" || id.length === 0) {
      throw new HttpError(400, "Each ranked item must include a non-empty id");
    }
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new HttpError(400, "Each ranked item must include a title");
    }
    if (typeof itemCategory !== "string") {
      throw new HttpError(400, "Each ranked item must include a category");
    }

    let parsedCategory: Category;
    try {
      parsedCategory = parseCategory(itemCategory);
    } catch {
      throw new HttpError(400, `Unknown category "${itemCategory}"`);
    }
    if (parsedCategory !== category) {
      throw new HttpError(
        400,
        `Item category "${parsedCategory}" does not match "${category}"`,
      );
    }

    items.push({
      id,
      category: parsedCategory,
      title: title.trim(),
    });
  }

  return items;
}

async function requireUser(
  users: UserRepository,
  userId: string | undefined,
): Promise<string> {
  if (userId === undefined || userId.length === 0) {
    throw new HttpError(400, "A user is required");
  }
  if (!(await users.listUsers()).some((user) => user.id === userId)) {
    throw new HttpError(404, `User "${userId}" was not found`);
  }
  return userId;
}

function validateCategory(value: string | undefined): Category {
  if (value === undefined) {
    throw new HttpError(400, "A category is required");
  }
  try {
    return parseCategory(value);
  } catch {
    throw new HttpError(
      400,
      `Unknown category "${value}". Expected one of: ${categories.join(", ")}`,
    );
  }
}

/** Runs a core call, mapping its validation errors to HTTP status codes. */
async function runCatch<T>(
  action: () => T | Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes("was not found") ? 404 : 400;
      throw new HttpError(status, error.message);
    }
    throw error;
  }
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  const raw = (await c.req.text()).trim();
  if (raw.length > 1_000_000) {
    throw new HttpError(413, "Request body is too large");
  }
  if (raw.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

async function serveStatic(
  pathname: string,
  webRoot: string,
): Promise<Response> {
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = normalize(join(webRoot, relative));
  if (target !== webRoot && !target.startsWith(webRoot + sep)) {
    throw new HttpError(403, "Forbidden");
  }

  let file: Buffer;
  try {
    file = await readFile(target);
  } catch {
    // Fall back to the SPA entry point for unknown non-file routes.
    try {
      file = await readFile(join(webRoot, "index.html"));
      return fileResponse(file, contentTypes[".html"] ?? "text/html");
    } catch {
      throw new HttpError(404, "Not found");
    }
  }

  const type = contentTypes[extname(target)] ?? "application/octet-stream";
  return fileResponse(file, type);
}

function fileResponse(file: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(file), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function respondToError(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(error.status, { error: error.message });
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("Unhandled API error:", message);
  return jsonResponse(500, { error: "Internal server error" });
}
