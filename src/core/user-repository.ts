import type { User } from "./types.js";

export interface UserRepository {
  listUsers(): readonly User[];
  createUser(name: string): User;
  findUserByName(name: string): User | undefined;
  close(): void;
}
