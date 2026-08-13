import type { User } from "./types.js";

export interface UserRepository {
  listUsers(): Promise<readonly User[]>;
  createUser(name: string): Promise<User>;
  findUserByName(name: string): Promise<User | undefined>;
  close(): Promise<void>;
}
