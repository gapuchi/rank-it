import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { Command, CommanderError } from "commander";

import {
  type BulkRankingPrompt,
  type BulkRankingSession,
  type CatalogRankingSession,
  CatalogService,
  completeBulkRanking,
  completeRanking,
  type CatalogRepository,
  type Category,
  type MetadataMatch,
  type MetadataProvider,
  type RankingPrompt,
  type UserRepository,
} from "../core/index.js";
import { parseCategory } from "../core/types.js";
import { createTmdbMetadataProviderFromEnvironment } from "../metadata/index.js";
import { SqliteCatalogRepository } from "../storage/index.js";
import { parseTitleCsv } from "./csv.js";

interface RankItRepository extends CatalogRepository, UserRepository {}

interface CliDependencies {
  readonly ask: (question: string) => Promise<string>;
  readonly write: (message: string) => void;
  readonly databasePath: string;
  readonly defaultUserName?: string;
  readonly generateId: () => string;
  readonly createRepository?: (databasePath: string) => RankItRepository;
  readonly metadataProvider?: MetadataProvider;
}

type UserOption = { user?: string };
type AddOptions = UserOption & { unverified?: boolean };
type ImportOptions = UserOption & { replace?: boolean; verify?: boolean };
type SearchOptions = { limit?: string };

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<void> {
  const createRepository =
    dependencies.createRepository ?? createSqliteRepository;
  const repository = createRepository(dependencies.databasePath);

  const metadataProvider = dependencies.metadataProvider;
  const createService = (): CatalogService =>
    new CatalogService(repository, dependencies.generateId, {
      ...(metadataProvider === undefined ? {} : { metadataProvider }),
    });

  const program = new Command();
  program
    .name("rank-it")
    .description("Track and rank movies, TV shows, and video games you have completed")
    .configureOutput({
      writeOut: (string) => dependencies.write(string.replace(/\n$/, "")),
      writeErr: (string) => dependencies.write(string.replace(/\n$/, "")),
    })
    .showHelpAfterError()
    .exitOverride();

  program.action(() => {
    program.outputHelp();
  });

  const users = program.command("users").description("Manage users");

  users
    .command("list")
    .description("List users")
    .action(async () => {
      const listed = await repository.listUsers();
      if (listed.length === 0) {
        dependencies.write("No users yet. Create one with: users create <name>");
        return;
      }
      for (const user of listed) {
        dependencies.write(`${user.name}  (${user.id})`);
      }
    });

  users
    .command("create")
    .description("Create a user")
    .argument("<name...>", "user name")
    .action(async (nameParts: string[]) => {
      const name = nameParts.join(" ").trim();
      if (name.length === 0) {
        throw new Error("A user name is required");
      }
      const user = await repository.createUser(name);
      dependencies.write(`Created user "${user.name}" (${user.id})`);
    });

  program
    .command("add")
    .description("Add and rank an item")
    .argument("<category>", "movies | tv-shows | video-games")
    .argument("<title...>", "item title or search terms")
    .option("--user <name>", "user name")
    .option("--unverified", "skip the title database and use the text as typed")
    .action(async (categoryValue: string, titleParts: string[], options: AddOptions) => {
      const title = titleParts.join(" ").trim();
      if (title.length === 0) {
        throw new Error("A title is required");
      }
      const category = parseCategory(categoryValue);
      const user = await resolveUser(
        repository,
        options.user,
        dependencies,
      );
      const service = createService();
      const verify =
        options.unverified !== true && service.supportsMetadata(category);

      const session = verify
        ? await addFromSearch(
            service,
            { userId: user.id, category, query: title },
            dependencies,
          )
        : await service.addItem({ userId: user.id, category, title });

      if (session === undefined) {
        dependencies.write("Cancelled. Nothing was added.");
        return;
      }

      const result = await completeRanking(session, (prompt) =>
        askComparison(prompt, dependencies),
      );
      dependencies.write(
        `Ranked "${result.item.title}" at #${result.item.position} (${result.item.score.toFixed(1)}) for ${user.name}`,
      );
    });

  program
    .command("search")
    .description("Search the title database without adding anything")
    .argument("<category>", "movies | tv-shows")
    .argument("<query...>", "search terms")
    .option("--limit <count>", "maximum results to show")
    .action(async (categoryValue: string, queryParts: string[], options: SearchOptions) => {
      const category = parseCategory(categoryValue);
      const service = createService();
      const matches = await service.searchMetadata(
        category,
        queryParts.join(" "),
        options.limit === undefined ? {} : { limit: Number(options.limit) },
      );

      if (matches.length === 0) {
        dependencies.write("No matching titles found.");
        return;
      }
      for (const match of matches) {
        dependencies.write(describeMatch(match));
      }
    });

  program
    .command("import")
    .description("Import and rank unordered titles from a CSV file")
    .argument("<category>", "movies | tv-shows | video-games")
    .argument("<file>", 'CSV file with a "title" column')
    .option("--user <name>", "user name")
    .option("--replace", "replace the existing category instead of appending")
    .option("--verify", "confirm every title against the title database")
    .action(
      async (
        categoryValue: string,
        file: string,
        options: ImportOptions,
      ) => {
        const category = parseCategory(categoryValue);
        const titles = parseTitleCsv(readFileSync(file, "utf8"));
        if (titles.length === 0) {
          throw new Error("CSV does not contain any titles");
        }

        const user = await resolveUser(
          repository,
          options.user,
          dependencies,
        );
        const service = createService();

        let rows;
        if (options.verify === true) {
          const resolved = await service.resolveTitles(category, titles);
          for (const title of resolved.unmatched) {
            dependencies.write(
              `Skipped "${title}": no match in the title database.`,
            );
          }
          if (resolved.items.length === 0) {
            throw new Error("No imported titles could be confirmed");
          }
          rows = { items: resolved.items };
        } else {
          rows = { titles };
        }

        const session = await service.importUnordered({
          userId: user.id,
          category,
          ...rows,
          mode: options.replace === true ? "replace" : "append",
        });
        const result = await completeBulkRanking(session, (prompt) =>
          askBulkComparison(prompt, dependencies),
        );
        dependencies.write(
          `Imported and ranked ${result.imported} ${result.imported === 1 ? "item" : "items"} in ${category} for ${user.name}.`,
        );
      },
    );

  program
    .command("list")
    .description("List ranked items in a category")
    .argument("<category>", "movies | tv-shows | video-games")
    .option("--user <name>", "user name")
    .action(async (categoryValue: string, options: UserOption) => {
      const category = parseCategory(categoryValue);
      const user = await resolveUser(
        repository,
        options.user,
        dependencies,
      );
      const service = createService();
      const items = await service.list(user.id, category);
      if (items.length === 0) {
        dependencies.write(`No ranked items in ${category} for ${user.name}.`);
        return;
      }
      for (const item of items) {
        const verified = item.source === undefined ? "" : ` [${item.source}]`;
        dependencies.write(
          `#${item.position}  ${item.score.toFixed(1)}  ${item.id}  ${item.title}${verified}`,
        );
      }
    });

  program
    .command("delete")
    .description("Delete an item by ID")
    .argument("<category>", "movies | tv-shows | video-games")
    .argument("<item-id>", "item ID")
    .option("--user <name>", "user name")
    .action(async (categoryValue: string, itemId: string, options: UserOption) => {
      const category = parseCategory(categoryValue);
      const user = await resolveUser(
        repository,
        options.user,
        dependencies,
      );
      const service = createService();
      await service.delete(user.id, category, itemId);
      dependencies.write(`Deleted ${itemId} from ${category} for ${user.name}.`);
    });

  program
    .command("rerank")
    .description("Re-rank an item by ID")
    .argument("<category>", "movies | tv-shows | video-games")
    .argument("<item-id>", "item ID")
    .option("--user <name>", "user name")
    .action(async (categoryValue: string, itemId: string, options: UserOption) => {
      const category = parseCategory(categoryValue);
      const user = await resolveUser(
        repository,
        options.user,
        dependencies,
      );
      const service = createService();
      const session = await service.rerank(
        user.id,
        category,
        itemId,
      );
      const result = await completeRanking(session, (prompt) =>
        askComparison(prompt, dependencies),
      );
      dependencies.write(
        `Re-ranked "${result.item.title}" at #${result.item.position} (${result.item.score.toFixed(1)}) for ${user.name}`,
      );
    });

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.help" ||
        error.code === "commander.version"
      ) {
        return;
      }
      throw new Error(error.message);
    }
    throw error;
  } finally {
    await repository.close();
  }
}

async function resolveUser(
  repository: UserRepository,
  userFlag: string | undefined,
  dependencies: Pick<CliDependencies, "defaultUserName" | "write">,
): Promise<{ id: string; name: string }> {
  const requestedName = userFlag ?? dependencies.defaultUserName ?? "default";
  const existing = await repository.findUserByName(requestedName);
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

/**
 * Confirms a typed title against the metadata provider before it can enter the
 * catalog. Returns undefined when the user rejects every candidate.
 */
async function addFromSearch(
  service: CatalogService,
  input: { userId: string; category: Category; query: string },
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<CatalogRankingSession | undefined> {
  const matches = await service.searchMetadata(input.category, input.query, {
    limit: 5,
  });

  if (matches.length === 0) {
    throw new Error(
      `No ${input.category} match "${input.query}". Add it with --unverified to skip the title database.`,
    );
  }

  const chosen = await chooseMatch(matches, dependencies);
  if (chosen === undefined) {
    return undefined;
  }

  return service.addMatchedItem({
    userId: input.userId,
    category: input.category,
    source: chosen.source,
    sourceId: chosen.sourceId,
  });
}

async function chooseMatch(
  matches: readonly MetadataMatch[],
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<MetadataMatch | undefined> {
  if (matches.length === 1) {
    const only = matches[0]!;
    const confirmed = await askYesOrNo(
      `Is this the one? ${describeMatch(only)} [y/n]: `,
      dependencies,
    );
    return confirmed ? only : undefined;
  }

  matches.forEach((match, index) => {
    dependencies.write(`${index + 1}) ${describeMatch(match)}`);
  });

  while (true) {
    const answer = (
      await dependencies.ask(`Which one? [1-${matches.length}, n to cancel]: `)
    )
      .trim()
      .toLowerCase();
    if (answer === "n" || answer === "no") {
      return undefined;
    }
    const choice = Number(answer);
    if (Number.isInteger(choice) && choice >= 1 && choice <= matches.length) {
      return matches[choice - 1];
    }
    dependencies.write(
      `Please enter a number from 1 to ${matches.length}, or n.`,
    );
  }
}

function describeMatch(match: MetadataMatch): string {
  const year = match.year === undefined ? "" : ` (${match.year})`;
  return `${match.title}${year}  [${match.source}:${match.sourceId}]`;
}

async function askBulkComparison(
  prompt: Extract<BulkRankingPrompt, { type: "compare" }>,
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<boolean> {
  return askYesOrNo(
    `Ranking ${prompt.current}/${prompt.total}: Was "${prompt.item.title}" better than "${prompt.against.title}"? [y/n]: `,
    dependencies,
  );
}

async function askComparison(
  prompt: Extract<RankingPrompt, { type: "compare" }>,
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<boolean> {
  return askYesOrNo(
    `Was "${prompt.item.title}" better than "${prompt.against.title}"? [y/n]: `,
    dependencies,
  );
}

async function askYesOrNo(
  question: string,
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<boolean> {
  while (true) {
    const answer = (await dependencies.ask(question))
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

/**
 * Reads a single keypress from an interactive terminal so answers like the
 * ranking `[y/n]` prompt submit as soon as a key is pressed, with no Enter
 * required. Control keys (arrows, Escape, Enter) are ignored so the caller can
 * keep waiting for a real character; Ctrl+C aborts.
 */
function createKeypressAsker(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
): (question: string) => Promise<string> {
  return (question) =>
    new Promise<string>((resolve, reject) => {
      output.write(question);
      const wasRaw = input.isRaw ?? false;
      input.setRawMode(true);
      input.resume();

      const cleanup = (): void => {
        input.off("data", onData);
        input.setRawMode(wasRaw);
        input.pause();
      };

      const onData = (data: Buffer): void => {
        const char = data.toString("utf8").charAt(0);
        if (char === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "" || char.charCodeAt(0) < 0x20) {
          return;
        }
        cleanup();
        output.write(`${char}\n`);
        resolve(char);
      };

      input.on("data", onData);
    });
}

async function main(): Promise<void> {
  const input = process.stdin;
  const output = process.stdout;

  let readline: ReturnType<typeof createInterface> | undefined;
  const ask = input.isTTY
    ? createKeypressAsker(input, output)
    : (question: string): Promise<string> => {
        readline ??= createInterface({ input, output });
        return readline.question(question);
      };

  const defaultUserName = process.env.RANK_IT_USER;
  const metadataProvider = createTmdbMetadataProviderFromEnvironment(
    process.env,
  );
  try {
    await runCli(process.argv.slice(2), {
      ask,
      write: (message) => console.log(message),
      databasePath: defaultDatabasePath(process.env),
      ...(defaultUserName === undefined
        ? {}
        : { defaultUserName }),
      ...(metadataProvider === undefined ? {} : { metadataProvider }),
      generateId: randomUUID,
    });
  } finally {
    readline?.close();
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
