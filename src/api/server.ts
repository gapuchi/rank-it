import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

import {
  CatalogService,
  categories,
  parseCategory,
  type Category,
  type CatalogRepository,
  type RankingAnswer,
  type UserRepository,
} from "../core/index.js";
import {
  RankingSessionStore,
  SessionNotFoundError,
} from "./ranking-session-store.js";

export interface ApiServerOptions {
  readonly catalogRepository: CatalogRepository;
  readonly userRepository: UserRepository;
  readonly generateId?: () => string;
  readonly sessionStore?: RankingSessionStore;
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
  readonly users: UserRepository;
  readonly sessions: RankingSessionStore;
  readonly webRoot: string | undefined;
}

export function createApiServer(options: ApiServerOptions): Server {
  const generateId = options.generateId ?? randomUUID;
  const handlers: Handlers = {
    service: new CatalogService(options.catalogRepository, generateId),
    users: options.userRepository,
    sessions: options.sessionStore ?? new RankingSessionStore(),
    webRoot: options.webRoot === undefined ? undefined : resolve(options.webRoot),
  };

  return createServer((request, response) => {
    handle(request, response, handlers).catch((error: unknown) => {
      respondToError(response, error);
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  handlers: Handlers,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter((part) => part.length > 0);

  if (segments[0] === "api") {
    await handleApi(method, segments.slice(1), request, response, handlers);
    return;
  }

  if (method === "GET" && handlers.webRoot !== undefined) {
    await serveStatic(url.pathname, handlers.webRoot, response);
    return;
  }

  throw new HttpError(404, "Not found");
}

async function handleApi(
  method: string,
  segments: readonly string[],
  request: IncomingMessage,
  response: ServerResponse,
  handlers: Handlers,
): Promise<void> {
  const { service, users, sessions } = handlers;

  if (segments[0] === "health" && segments.length === 1) {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (segments[0] === "categories" && segments.length === 1) {
    if (method !== "GET") throw methodNotAllowed();
    sendJson(response, 200, { categories });
    return;
  }

  if (segments[0] === "users" && segments.length === 1) {
    if (method === "GET") {
      sendJson(response, 200, { users: users.listUsers() });
      return;
    }
    if (method === "POST") {
      const body = await readJson(request);
      const name = body["name"];
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new HttpError(400, "A user name is required");
      }
      const user = runCatch(() => users.createUser(name));
      sendJson(response, 201, { user });
      return;
    }
    throw methodNotAllowed();
  }

  // /users/:userId/categories/:category/items ...
  if (
    segments[0] === "users" &&
    segments[2] === "categories" &&
    segments[4] === "items"
  ) {
    const userId = requireUser(users, segments[1]);
    const category = validateCategory(segments[3]);

    if (segments.length === 5) {
      if (method === "GET") {
        sendJson(response, 200, { items: service.list(userId, category) });
        return;
      }
      if (method === "POST") {
        const title = await readTitle(request);
        const session = runCatch(() =>
          service.addItem({ userId, category, title }),
        );
        sendJson(response, 201, sessions.start(session));
        return;
      }
      throw methodNotAllowed();
    }

    const itemId = segments[5];
    if (itemId !== undefined && segments.length === 6) {
      if (method === "DELETE") {
        runCatch(() => service.delete(userId, category, itemId));
        response.writeHead(204);
        response.end();
        return;
      }
      throw methodNotAllowed();
    }

    if (
      itemId !== undefined &&
      segments[6] === "rerank" &&
      segments.length === 7
    ) {
      if (method !== "POST") throw methodNotAllowed();
      const session = runCatch(() =>
        service.rerank(userId, category, itemId),
      );
      sendJson(response, 201, sessions.start(session));
      return;
    }
  }

  // /sessions/:id/answer
  if (
    segments[0] === "sessions" &&
    segments[2] === "answer" &&
    segments.length === 3
  ) {
    if (method !== "POST") throw methodNotAllowed();
    const sessionId = segments[1];
    if (sessionId === undefined) throw new HttpError(404, "Not found");
    const answer = await readAnswer(request);
    try {
      const prompt = sessions.answer(sessionId, answer);
      sendJson(response, 200, { prompt });
    } catch (error: unknown) {
      if (error instanceof SessionNotFoundError) {
        throw new HttpError(404, error.message);
      }
      if (error instanceof Error) {
        throw new HttpError(400, error.message);
      }
      throw error;
    }
    return;
  }

  throw new HttpError(404, "Not found");
}

async function readTitle(request: IncomingMessage): Promise<string> {
  const body = await readJson(request);
  const title = body["title"];
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new HttpError(400, "A title is required");
  }
  return title;
}

async function readAnswer(request: IncomingMessage): Promise<RankingAnswer> {
  const body = await readJson(request);
  const better = body["better"];
  if (typeof better !== "boolean") {
    throw new HttpError(400, "Answer must include a boolean better flag");
  }
  return { better };
}

function requireUser(
  users: UserRepository,
  userId: string | undefined,
): string {
  if (userId === undefined || userId.length === 0) {
    throw new HttpError(400, "A user is required");
  }
  if (!users.listUsers().some((user) => user.id === userId)) {
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
function runCatch<T>(action: () => T): T {
  try {
    return action();
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes("was not found") ? 404 : 400;
      throw new HttpError(status, error.message);
    }
    throw error;
  }
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 1_000_000) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
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
  response: ServerResponse,
): Promise<void> {
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
      response.writeHead(200, {
        "content-type": contentTypes[".html"] ?? "text/html",
      });
      response.end(file);
      return;
    } catch {
      throw new HttpError(404, "Not found");
    }
  }

  const type = contentTypes[extname(target)] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  response.end(file);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function methodNotAllowed(): HttpError {
  return new HttpError(405, "Method not allowed");
}

function respondToError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  if (error instanceof HttpError) {
    sendJson(response, error.status, { error: error.message });
    return;
  }

  if (error instanceof SessionNotFoundError) {
    sendJson(response, 404, { error: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("Unhandled API error:", message);
  sendJson(response, 500, { error: "Internal server error" });
}
