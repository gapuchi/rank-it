import { randomUUID } from "node:crypto";

import type {
  CatalogRankingSession,
  RankingAnswer,
  RankingPrompt,
} from "../core/index.js";

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Ranking session "${id}" was not found or has expired`);
    this.name = "SessionNotFoundError";
  }
}

export interface StartedSession {
  readonly sessionId: string | null;
  readonly prompt: RankingPrompt;
}

interface StoredSession {
  readonly session: CatalogRankingSession;
  expiresAt: number;
}

export interface RankingSessionStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly generateId?: () => string;
}

const defaultTtlMs = 30 * 60 * 1000;

/**
 * Holds in-progress ranking sessions in memory, keyed by an opaque id, so the
 * multi-step bucket/compare flow can span several HTTP requests. State lives in
 * a single server process, which is sufficient for the single-instance,
 * single-user deployment this targets.
 */
export class RankingSessionStore {
  readonly #sessions = new Map<string, StoredSession>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #generateId: () => string;

  constructor(options: RankingSessionStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? defaultTtlMs;
    this.#now = options.now ?? Date.now;
    this.#generateId = options.generateId ?? randomUUID;
  }

  start(session: CatalogRankingSession): StartedSession {
    this.#prune();
    const prompt = session.next();
    if (prompt.type === "done") {
      return { sessionId: null, prompt };
    }

    const sessionId = this.#generateId();
    this.#sessions.set(sessionId, {
      session,
      expiresAt: this.#now() + this.#ttlMs,
    });
    return { sessionId, prompt };
  }

  answer(sessionId: string, answer: RankingAnswer): RankingPrompt {
    this.#prune();
    const stored = this.#sessions.get(sessionId);
    if (stored === undefined) {
      throw new SessionNotFoundError(sessionId);
    }

    const prompt = stored.session.answer(answer);
    if (prompt.type === "done") {
      this.#sessions.delete(sessionId);
    } else {
      stored.expiresAt = this.#now() + this.#ttlMs;
    }
    return prompt;
  }

  get size(): number {
    this.#prune();
    return this.#sessions.size;
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, stored] of this.#sessions) {
      if (stored.expiresAt <= now) {
        this.#sessions.delete(id);
      }
    }
  }
}
