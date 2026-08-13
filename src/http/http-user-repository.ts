import type { UserRepository } from "../core/user-repository.js";
import type { User } from "../core/types.js";
import { apiRequest, type HttpClientOptions } from "./client.js";

export class HttpUserRepository implements UserRepository {
  readonly #options: HttpClientOptions;

  constructor(options: HttpClientOptions = {}) {
    this.#options = options;
  }

  async listUsers(): Promise<readonly User[]> {
    const response = await apiRequest<{ readonly users: readonly User[] }>(
      "/users",
      {},
      this.#options,
    );
    return response.users;
  }

  async createUser(name: string): Promise<User> {
    const response = await apiRequest<{ readonly user: User }>(
      "/users",
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
      this.#options,
    );
    return response.user;
  }

  async findUserByName(name: string): Promise<User | undefined> {
    const users = await this.listUsers();
    const normalized = name.trim().toLowerCase();
    return users.find((user) => user.name.toLowerCase() === normalized);
  }

  async close(): Promise<void> {}
}
