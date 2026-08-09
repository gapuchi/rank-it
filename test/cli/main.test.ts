import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/main.js";

const temporaryDirectories: string[] = [];

function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), "rank-it-cli-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "rank-it.db");
  let nextId = 1;

  return {
    writeCsv(name: string, contents: string): string {
      const path = join(directory, name);
      writeFileSync(path, contents);
      return path;
    },
    async execute(argv: readonly string[], answers: string[] = []) {
      const output: string[] = [];
      await runCli(argv, {
        ask: async () => {
          const answer = answers.shift();
          if (answer === undefined) {
            throw new Error("Test did not provide an answer");
          }
          return answer;
        },
        write: (message) => output.push(message),
        databasePath,
        generateId: () => `item-${nextId++}`,
      });
      return output;
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runCli", () => {
  it("adds items interactively and lists their ranking", async () => {
    const harness = createHarness();

    await expect(
      harness.execute(["add", "movies", "Arrival"]),
    ).resolves.toEqual(['Ranked "Arrival" at #1 (10.0) for default']);
    await expect(
      harness.execute(["add", "movies", "Moonlight"], ["no"]),
    ).resolves.toEqual(['Ranked "Moonlight" at #2 (0.0) for default']);

    await expect(harness.execute(["list", "movies"])).resolves.toEqual([
      "#1  10.0  item-1  Arrival",
      "#2  0.0  item-2  Moonlight",
    ]);
  });

  it("re-ranks and deletes items by ID", async () => {
    const harness = createHarness();
    await harness.execute(["add", "video-games", "Outer Wilds"]);
    await harness.execute(["add", "video-games", "Disco Elysium"], ["no"]);

    await expect(
      harness.execute(["rerank", "video-games", "item-2"], ["yes"]),
    ).resolves.toEqual(['Re-ranked "Disco Elysium" at #1 (10.0) for default']);
    await expect(
      harness.execute(["delete", "video-games", "item-1"]),
    ).resolves.toEqual(["Deleted item-1 from video-games for default."]);
    await expect(
      harness.execute(["list", "video-games"]),
    ).resolves.toEqual(["#1  10.0  item-2  Disco Elysium"]);
  });

  it("imports and ranks unordered CSV titles", async () => {
    const harness = createHarness();
    const csv = harness.writeCsv(
      "movies.csv",
      "title\nArrival\nMoonlight\nParasite\n",
    );

    await expect(
      harness.execute(
        ["import", "movies", csv],
        ["yes", "yes", "no"],
      ),
    ).resolves.toEqual([
      "Imported and ranked 3 items in movies for default.",
    ]);
    await expect(harness.execute(["list", "movies"])).resolves.toEqual([
      "#1  10.0  item-1  Arrival",
      "#2  5.0  item-3  Parasite",
      "#3  0.0  item-2  Moonlight",
    ]);
  });

  it("can replace an existing ranking with an imported CSV", async () => {
    const harness = createHarness();
    await harness.execute(["add", "movies", "Existing"]);
    const csv = harness.writeCsv("replacement.csv", "title\nReplacement\n");

    await expect(
      harness.execute(["import", "movies", csv, "--replace"]),
    ).resolves.toEqual([
      "Imported and ranked 1 item in movies for default.",
    ]);
    await expect(harness.execute(["list", "movies"])).resolves.toEqual([
      "#1  10.0  item-2  Replacement",
    ]);
  });

  it("creates and scopes rankings to named users", async () => {
    const harness = createHarness();

    await expect(harness.execute(["users", "create", "Alice"])).resolves.toEqual(
      expect.arrayContaining([expect.stringMatching(/^Created user "Alice"/)]),
    );
    await harness.execute([
      "add",
      "movies",
      "Her",
      "--user",
      "Alice",
    ]);
    await expect(
      harness.execute(["list", "movies", "--user", "Alice"]),
    ).resolves.toEqual(["#1  10.0  item-1  Her"]);
    await expect(harness.execute(["list", "movies"])).resolves.toEqual([
      "No ranked items in movies for default.",
    ]);
  });

  it("reports invalid categories without creating a ranking", async () => {
    const harness = createHarness();

    await expect(harness.execute(["list", "books"])).rejects.toThrow(
      "Unknown category",
    );
  });
});
