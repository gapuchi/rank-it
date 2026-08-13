import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SqliteCatalogRepository } from "../storage/index.js";
import { createApiServer } from "./server.js";

function defaultDatabasePath(environment: NodeJS.ProcessEnv): string {
  if (environment.RANK_IT_DB) {
    return environment.RANK_IT_DB;
  }

  const dataDirectory =
    environment.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataDirectory, "rank-it", "rank-it.db");
}

async function main(): Promise<void> {
  const databasePath = defaultDatabasePath(process.env);
  mkdirSync(dirname(databasePath), { recursive: true });

  const repository = new SqliteCatalogRepository(databasePath);
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const webRoot = join(moduleDirectory, "..", "..", "dist", "web");

  const defaultUserName = process.env.RANK_IT_USER ?? "default";
  if ((await repository.findUserByName(defaultUserName)) === undefined) {
    await repository.createUser(defaultUserName);
  }

  const server = createApiServer({
    catalogRepository: repository,
    userRepository: repository,
    generateId: randomUUID,
    webRoot,
  });

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "127.0.0.1";

  server.listen(port, host, () => {
    console.log(`rank-it is running at http://${host}:${port}`);
    console.log(`Using database ${databasePath}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      void repository.close().then(
        () => process.exit(0),
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`Failed to close database: ${message}`);
          process.exit(1);
        },
      );
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
