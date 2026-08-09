import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";

import {
  CatalogService,
  type CatalogRankingSession,
  type CatalogRepository,
  type RankingPrompt,
  type UserRepository,
} from "../core/index.js";
import { parseCategory } from "../core/types.js";
import { SqliteCatalogRepository } from "../storage/index.js";

interface RankItRepository extends CatalogRepository, UserRepository {}

interface CliDependencies {
  readonly ask: (question: string) => Promise<string>;
  readonly write: (message: string) => void;
  readonly databasePath: string;
  readonly defaultUserName?: string;
  readonly generateId: () => string;
  readonly createRepository?: (databasePath: string) => RankItRepository;
}

const usage = `rank-it — track and rank what you have completed

Usage:
  npm run rank-it -- users list
  npm run rank-it -- users create <name>
  npm run rank-it -- add <category> <title> [--user <name>]
  npm run rank-it -- list <category> [--user <name>]
  npm run rank-it -- delete <category> <item-id> [--user <name>]
  npm run rank-it -- rerank <category> <item-id> [--user <name>]

Categories: movies, tv-shows, video-games
Set RANK_IT_USER for the default user name. Set RANK_IT_DB to override the database location.`;

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<void> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      user: { type: "string" },
    },
  });

  if (values.help || positionals.length === 0) {
    dependencies.write(usage);
    return;
  }

  const [command] = positionals;
  const createRepository =
    dependencies.createRepository ?? createSqliteRepository;
  const repository = createRepository(dependencies.databasePath);

  try {
    if (command === "users") {
      await runUsersCommand(positionals, repository, dependencies);
      return;
    }

    if (
      command !== "add" &&
      command !== "list" &&
      command !== "delete" &&
      command !== "rerank"
    ) {
      throw new Error(`Unknown command "${command}"\n\n${usage}`);
    }

    const categoryValue = positionals[1];
    if (categoryValue === undefined) {
      throw new Error(`A category is required\n\n${usage}`);
    }
    const category = parseCategory(categoryValue);
    const user = resolveUser(repository, values.user, dependencies);
    const service = new CatalogService(repository, dependencies.generateId);

    switch (command) {
      case "add": {
        const title = positionals.slice(2).join(" ");
        if (title.length === 0) {
          throw new Error("A title is required");
        }
        const session = service.addItem({
          userId: user.id,
          category,
          title,
        });
        const result = await completeRanking(session, dependencies);
        dependencies.write(
          `Ranked "${result.item.title}" at #${result.item.position} (${result.item.score.toFixed(1)}) for ${user.name}`,
        );
        return;
      }
      case "list": {
        const items = service.list(user.id, category);
        if (items.length === 0) {
          dependencies.write(`No ranked items in ${category} for ${user.name}.`);
          return;
        }
        for (const item of items) {
          dependencies.write(
            `#${item.position}  ${item.score.toFixed(1)}  ${item.id}  ${item.title}`,
          );
        }
        return;
      }
      case "delete": {
        const itemId = requireItemId(positionals);
        service.delete(user.id, category, itemId);
        dependencies.write(`Deleted ${itemId} from ${category} for ${user.name}.`);
        return;
      }
      case "rerank": {
        const itemId = requireItemId(positionals);
        const result = await completeRanking(
          service.rerank(user.id, category, itemId),
          dependencies,
        );
        dependencies.write(
          `Re-ranked "${result.item.title}" at #${result.item.position} (${result.item.score.toFixed(1)}) for ${user.name}`,
        );
      }
    }
  } finally {
    repository.close();
  }
}

async function runUsersCommand(
  positionals: readonly string[],
  repository: UserRepository,
  dependencies: Pick<CliDependencies, "write">,
): Promise<void> {
  const subcommand = positionals[1];
  if (subcommand === "list") {
    const users = repository.listUsers();
    if (users.length === 0) {
      dependencies.write("No users yet. Create one with: users create <name>");
      return;
    }
    for (const user of users) {
      dependencies.write(`${user.name}  (${user.id})`);
    }
    return;
  }

  if (subcommand === "create") {
    const name = positionals.slice(2).join(" ");
    if (name.length === 0) {
      throw new Error("A user name is required");
    }
    const user = repository.createUser(name);
    dependencies.write(`Created user "${user.name}" (${user.id})`);
    return;
  }

  throw new Error(
    `Unknown users subcommand "${subcommand ?? ""}"\n\n${usage}`,
  );
}

function resolveUser(
  repository: UserRepository,
  userFlag: string | undefined,
  dependencies: Pick<CliDependencies, "defaultUserName" | "write">,
): { id: string; name: string } {
  const requestedName = userFlag ?? dependencies.defaultUserName ?? "default";
  const existing = repository.findUserByName(requestedName);
  if (existing !== undefined) {
    return existing;
  }

  if (requestedName.toLowerCase() === "default") {
    return repository.createUser("default");
  }

  throw new Error(
    `User "${requestedName}" was not found. Create them with: users create ${requestedName}`,
  );
}

function createSqliteRepository(databasePath: string): RankItRepository {
  mkdirSync(dirname(databasePath), { recursive: true });
  return new SqliteCatalogRepository(databasePath);
}

function requireItemId(positionals: readonly string[]): string {
  const itemId = positionals[2];
  if (itemId === undefined || positionals.length !== 3) {
    throw new Error("Exactly one item ID is required");
  }
  return itemId;
}

async function completeRanking(
  session: CatalogRankingSession,
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<Extract<RankingPrompt, { type: "done" }>> {
  let prompt = session.next();

  while (prompt.type !== "done") {
    const better = await askComparison(prompt, dependencies);
    prompt = session.answer({ better });
  }

  return prompt;
}

async function askComparison(
  prompt: Extract<RankingPrompt, { type: "compare" }>,
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<boolean> {
  while (true) {
    const answer = (
      await dependencies.ask(
        `Was "${prompt.item.title}" better than "${prompt.against.title}"? [y/n]: `,
      )
    )
      .trim()
      .toLowerCase();
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    dependencies.write("Please enter yes or no.");
  }
}

function defaultDatabasePath(environment: NodeJS.ProcessEnv): string {
  if (environment.RANK_IT_DB) {
    return environment.RANK_IT_DB;
  }

  const dataDirectory =
    environment.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataDirectory, "rank-it", "rank-it.db");
}

async function main(): Promise<void> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const defaultUserName = process.env.RANK_IT_USER;
  try {
    await runCli(process.argv.slice(2), {
      ask: (question) => readline.question(question),
      write: (message) => console.log(message),
      databasePath: defaultDatabasePath(process.env),
      ...(defaultUserName === undefined
        ? {}
        : { defaultUserName }),
      generateId: randomUUID,
    });
  } finally {
    readline.close();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
