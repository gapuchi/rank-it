import type { RankingPrompt } from "../core/ranking-session.js";
import type { Category, RankedItem, User } from "../core/types.js";

export interface SessionStarted {
  readonly sessionId: string | null;
  readonly prompt: RankingPrompt;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => ({}))) as {
    readonly error?: unknown;
  };
  if (!response.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

function itemsPath(userId: string, category: Category): string {
  return `/users/${userId}/categories/${category}/items`;
}

export async function listUsers(): Promise<readonly User[]> {
  const response = await request<{ readonly users: readonly User[] }>("/users");
  return response.users;
}

export async function createUser(name: string): Promise<User> {
  const response = await request<{ readonly user: User }>("/users", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return response.user;
}

export async function listCategories(): Promise<readonly Category[]> {
  const response = await request<{
    readonly categories: readonly Category[];
  }>("/categories");
  return response.categories;
}

export async function listItems(
  userId: string,
  category: Category,
): Promise<readonly RankedItem[]> {
  const response = await request<{ readonly items: readonly RankedItem[] }>(
    itemsPath(userId, category),
  );
  return response.items;
}

export function addItem(
  userId: string,
  category: Category,
  title: string,
): Promise<SessionStarted> {
  return request(itemsPath(userId, category), {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function deleteItem(
  userId: string,
  category: Category,
  itemId: string,
): Promise<void> {
  return request(`${itemsPath(userId, category)}/${itemId}`, {
    method: "DELETE",
  });
}

export function rerankItem(
  userId: string,
  category: Category,
  itemId: string,
): Promise<SessionStarted> {
  return request(`${itemsPath(userId, category)}/${itemId}/rerank`, {
    method: "POST",
  });
}

export async function answerSession(
  sessionId: string,
  better: boolean,
): Promise<RankingPrompt> {
  const response = await request<{ readonly prompt: RankingPrompt }>(
    `/sessions/${sessionId}/answer`,
    {
      method: "POST",
      body: JSON.stringify({ better }),
    },
  );
  return response.prompt;
}
