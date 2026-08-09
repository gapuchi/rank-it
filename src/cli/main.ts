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
  type RankingPrompt,
} from "../core/index.js";
import { parseCategory } from "../core/types.js";
import { SqliteCatalogRepository } from "../storage/index.js";

interface CliDependencies {
  readonly ask: (question: string) => Promise<string>;
  readonly write: (message: string) => void;
  readonly databasePath: string;
  readonly generateId: () => string;
}

const usage = `rank-it — track and rank what you have completed

Usage:
  npm run rank-it -- add <category> <title> [--year <year>] [--notes <notes>]
  npm run rank-it -- list <category>
  npm run rank-it -- delete <category> <item-id>
  npm run rank-it -- rerank <category> <item-id>

Categories: movies, tv-shows, video-games
Set RANK_IT_DB to override the database location.`;

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
      notes: { type: "string" },
      year: { type: "string" },
    },
  });

  if (values.help || positionals.length === 0) {
    dependencies.write(usage);
    return;
  }

  const [command, categoryValue] = positionals;
  if (
    command !== "add" &&
    command !== "list" &&
    command !== "delete" &&
    command !== "rerank"
  ) {
    throw new Error(`Unknown command "${command}"\n\n${usage}`);
  }
  if (categoryValue === undefined) {
    throw new Error(`A category is required\n\n${usage}`);
  }
  const category = parseCategory(categoryValue);

  mkdirSync(dirname(dependencies.databasePath), { recursive: true });
  const repository = new SqliteCatalogRepository(dependencies.databasePath);
  const service = new CatalogService(repository, dependencies.generateId);

  try {
    switch (command) {
      case "add": {
        const title = positionals.slice(2).join(" ");
        if (title.length === 0) {
          throw new Error("A title is required");
        }
        const year =
          values.year === undefined ? undefined : Number(values.year);
        const session = service.addItem({
          category,
          title,
          ...(year === undefined ? {} : { year }),
          ...(values.notes === undefined ? {} : { notes: values.notes }),
        });
        const result = await completeRanking(session, dependencies);
        dependencies.write(
          `Ranked "${result.item.title}" at #${result.item.position} (${result.item.score.toFixed(1)})`,
        );
        return;
      }
      case "list": {
        const items = service.list(category);
        if (items.length === 0) {
          dependencies.write(`No ranked items in ${category}.`);
          return;
        }
        for (const item of items) {
          const year = item.year === undefined ? "" : ` (${item.year})`;
          const notes =
            item.notes === undefined ? "" : ` — ${item.notes}`;
          dependencies.write(
            `#${item.position}  ${item.score.toFixed(1)}  ${item.id}  ${item.title}${year}${notes}`,
          );
        }
        return;
      }
      case "delete": {
        const itemId = requireItemId(positionals);
        service.delete(category, itemId);
        dependencies.write(`Deleted ${itemId} from ${category}.`);
        return;
      }
      case "rerank": {
        const itemId = requireItemId(positionals);
        const result = await completeRanking(
          service.rerank(category, itemId),
          dependencies,
        );
        dependencies.write(
          `Re-ranked "${result.item.title}" at #${result.item.position} (${result.item.score.toFixed(1)})`,
        );
      }
    }
  } finally {
    repository.close();
  }
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
    if (prompt.type === "bucket") {
      const answer = await askBucket(dependencies);
      prompt = session.answer({ bucket: answer });
    } else {
      const better = await askComparison(prompt, dependencies);
      prompt = session.answer({ better });
    }
  }

  return prompt;
}

async function askBucket(
  dependencies: Pick<CliDependencies, "ask" | "write">,
): Promise<"great" | "okay" | "bad"> {
  while (true) {
    const answer = (
      await dependencies.ask("Initial impression? [g]reat, [o]kay, [b]ad: ")
    )
      .trim()
      .toLowerCase();
    if (answer === "g" || answer === "great") return "great";
    if (answer === "o" || answer === "okay") return "okay";
    if (answer === "b" || answer === "bad") return "bad";
    dependencies.write("Please enter great, okay, or bad.");
  }
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

  try {
    await runCli(process.argv.slice(2), {
      ask: (question) => readline.question(question),
      write: (message) => console.log(message),
      databasePath: defaultDatabasePath(process.env),
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
