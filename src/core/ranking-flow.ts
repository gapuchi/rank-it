import type {
  BulkRankingSession,
  BulkRankingPrompt,
} from "./bulk-ranking-session.js";
import type { CatalogRankingSession } from "./catalog-service.js";
import type { RankingPrompt } from "./ranking-session.js";

export type ComparisonHandler = (
  prompt: Extract<RankingPrompt, { type: "compare" }>,
) => Promise<boolean>;

export type BulkComparisonHandler = (
  prompt: Extract<BulkRankingPrompt, { type: "compare" }>,
) => Promise<boolean>;

export async function completeRanking(
  session: CatalogRankingSession,
  ask: ComparisonHandler,
): Promise<Extract<RankingPrompt, { type: "done" }>> {
  let prompt = session.next();

  while (prompt.type !== "done") {
    const better = await ask(prompt);
    prompt = await session.answer({ better });
  }

  return prompt;
}

export async function completeBulkRanking(
  session: BulkRankingSession,
  ask: BulkComparisonHandler,
): Promise<Extract<BulkRankingPrompt, { type: "done" }>> {
  let prompt = session.next();

  while (prompt.type !== "done") {
    const better = await ask(prompt);
    prompt = await session.answer({ better });
  }

  return prompt;
}
