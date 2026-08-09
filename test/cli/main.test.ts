import { mkdtempSync, rmSync } from "node:fs";
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
      harness.execute(["add", "movies", "Arrival", "--year", "2016"]),
    ).resolves.toEqual(['Ranked "Arrival" at #1 (10.0)']);
    await expect(
      harness.execute(["add", "movies", "Moonlight"], ["great", "no"]),
    ).resolves.toEqual(['Ranked "Moonlight" at #2 (0.0)']);

    await expect(harness.execute(["list", "movies"])).resolves.toEqual([
      "#1  10.0  item-1  Arrival (2016)",
      "#2  0.0  item-2  Moonlight",
    ]);
  });

  it("re-ranks and deletes items by ID", async () => {
    const harness = createHarness();
    await harness.execute(["add", "video-games", "Outer Wilds"]);
    await harness.execute(
      ["add", "video-games", "Disco Elysium"],
      ["great", "no"],
    );

    await expect(
      harness.execute(
        ["rerank", "video-games", "item-2"],
        ["great", "yes"],
      ),
    ).resolves.toEqual(['Re-ranked "Disco Elysium" at #1 (10.0)']);
    await expect(
      harness.execute(["delete", "video-games", "item-1"]),
    ).resolves.toEqual(["Deleted item-1 from video-games."]);
    await expect(
      harness.execute(["list", "video-games"]),
    ).resolves.toEqual(["#1  10.0  item-2  Disco Elysium"]);
  });

  it("reports invalid categories without creating a ranking", async () => {
    const harness = createHarness();

    await expect(harness.execute(["list", "books"])).rejects.toThrow(
      "Unknown category",
    );
  });
});
