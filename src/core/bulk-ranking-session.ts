import type { CatalogRepository } from "./catalog-repository.js";
import type { RankingAnswer } from "./ranking-session.js";
import type { Category, Item } from "./types.js";

export type BulkRankingPrompt =
  | {
      readonly type: "compare";
      readonly item: Item;
      readonly against: Item;
      readonly current: number;
      readonly total: number;
    }
  | {
      readonly type: "done";
      readonly imported: number;
      readonly total: number;
    };

type MergeFrame = {
  readonly left: readonly Item[];
  readonly right: readonly Item[];
  result: Item[];
  leftIndex: number;
  rightIndex: number;
};

/**
 * Ranks an unordered import with bottom-up merge sort, then merges into any
 * existing ranking. Bulk imports stay at O(n log n) comparisons and persist
 * once at the end, instead of binary-inserting each title one by one.
 */
export class BulkRankingSession {
  readonly #repository: CatalogRepository;
  readonly #userId: string;
  readonly #category: Category;
  readonly #pendingItems: readonly Item[];
  readonly #existingItems: readonly Item[];
  readonly #estimatedComparisons: number;
  #runs: Item[][];
  #nextRuns: Item[][] = [];
  #runIndex = 0;
  #merge: MergeFrame | undefined;
  #mergedExisting = false;
  #comparisons = 0;
  #prompt: BulkRankingPrompt;

  constructor(
    repository: CatalogRepository,
    userId: string,
    category: Category,
    items: readonly Item[],
    rankedItems: readonly Item[],
  ) {
    if (items.length === 0) {
      throw new Error("At least one item is required for bulk ranking");
    }
    if (
      [...items, ...rankedItems].some((item) => item.category !== category)
    ) {
      throw new Error("All items in a bulk ranking session must share a category");
    }
    const itemIds = [...items, ...rankedItems].map(({ id }) => id);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new Error("A bulk ranking session cannot contain duplicate item IDs");
    }

    this.#repository = repository;
    this.#userId = userId;
    this.#category = category;
    this.#pendingItems = [...items];
    this.#existingItems = [...rankedItems];
    this.#estimatedComparisons = estimateBulkComparisons(
      items.length,
      rankedItems.length,
    );
    this.#runs = items.map((item) => [item]);
    this.#prompt = this.#advance();
  }

  next(): BulkRankingPrompt {
    return this.#prompt;
  }

  answer(answer: RankingAnswer): BulkRankingPrompt {
    if (this.#prompt.type === "done" || this.#merge === undefined) {
      throw new Error("This bulk ranking session is already complete");
    }

    const merge = this.#merge;
    if (answer.better) {
      const item = merge.left[merge.leftIndex];
      if (item === undefined) {
        throw new Error("Merge referenced a missing left item");
      }
      merge.result.push(item);
      merge.leftIndex += 1;
    } else {
      const item = merge.right[merge.rightIndex];
      if (item === undefined) {
        throw new Error("Merge referenced a missing right item");
      }
      merge.result.push(item);
      merge.rightIndex += 1;
    }

    this.#prompt = this.#advance();
    return this.#prompt;
  }

  #advance(): BulkRankingPrompt {
    while (true) {
      if (this.#merge !== undefined) {
        if (!this.#finishMergeIfPossible()) {
          return this.#comparisonPrompt();
        }
      }

      if (this.#runIndex < this.#runs.length) {
        const left = this.#runs[this.#runIndex];
        const right = this.#runs[this.#runIndex + 1];
        if (left === undefined) {
          throw new Error("Merge sort referenced a missing run");
        }

        if (right === undefined) {
          this.#nextRuns.push(left);
          this.#runIndex += 1;
          continue;
        }

        this.#runIndex += 2;
        this.#startNextMerge(left, right);
        continue;
      }

      if (this.#nextRuns.length > 0) {
        this.#runs = this.#nextRuns;
        this.#nextRuns = [];
        this.#runIndex = 0;
        if (this.#runs.length > 1) {
          continue;
        }
      }

      const sortedPending = this.#runs[0] ?? [];
      if (!this.#mergedExisting && this.#existingItems.length > 0) {
        this.#mergedExisting = true;
        this.#runs = [];
        this.#nextRuns = [];
        this.#runIndex = 0;
        this.#startNextMerge(this.#existingItems, sortedPending);
        continue;
      }

      return this.#complete(sortedPending);
    }
  }

  #startNextMerge(left: readonly Item[], right: readonly Item[]): void {
    this.#merge = {
      left,
      right,
      result: [],
      leftIndex: 0,
      rightIndex: 0,
    };
  }

  #finishMergeIfPossible(): boolean {
    const merge = this.#merge;
    if (merge === undefined) {
      return true;
    }

    if (
      merge.leftIndex < merge.left.length &&
      merge.rightIndex < merge.right.length
    ) {
      return false;
    }

    while (merge.leftIndex < merge.left.length) {
      const item = merge.left[merge.leftIndex];
      if (item === undefined) {
        throw new Error("Merge referenced a missing left item");
      }
      merge.result.push(item);
      merge.leftIndex += 1;
    }
    while (merge.rightIndex < merge.right.length) {
      const item = merge.right[merge.rightIndex];
      if (item === undefined) {
        throw new Error("Merge referenced a missing right item");
      }
      merge.result.push(item);
      merge.rightIndex += 1;
    }

    this.#nextRuns.push(merge.result);
    this.#merge = undefined;
    return true;
  }

  #comparisonPrompt(): BulkRankingPrompt {
    const merge = this.#merge;
    if (merge === undefined) {
      throw new Error("No merge is in progress");
    }

    const item = merge.left[merge.leftIndex];
    const against = merge.right[merge.rightIndex];
    if (item === undefined || against === undefined) {
      throw new Error("Merge referenced a missing comparison item");
    }

    this.#comparisons += 1;
    return {
      type: "compare",
      item,
      against,
      current: this.#comparisons,
      total: Math.max(this.#estimatedComparisons, this.#comparisons),
    };
  }

  #complete(rankedItems: readonly Item[]): BulkRankingPrompt {
    this.#repository.saveRanking(this.#userId, this.#category, rankedItems);
    this.#merge = undefined;
    return {
      type: "done",
      imported: this.#pendingItems.length,
      total: this.#pendingItems.length,
    };
  }
}

export function estimateBulkComparisons(
  pendingCount: number,
  existingCount: number,
): number {
  const sortComparisons = estimateMergeSortComparisons(pendingCount);
  if (existingCount === 0) {
    return sortComparisons;
  }
  return sortComparisons + pendingCount + existingCount - 1;
}

function estimateMergeSortComparisons(count: number): number {
  if (count <= 1) {
    return 0;
  }

  let comparisons = 0;
  for (let size = 1; size < count; size *= 2) {
    for (let start = 0; start < count; start += size * 2) {
      const middle = Math.min(start + size, count);
      const end = Math.min(start + size * 2, count);
      const leftLength = middle - start;
      const rightLength = end - middle;
      if (leftLength > 0 && rightLength > 0) {
        comparisons += leftLength + rightLength - 1;
      }
    }
  }
  return comparisons;
}
