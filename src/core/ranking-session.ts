import { scoreForPosition } from "./score.js";
import type { Item, RankedItem } from "./types.js";

export const buckets = ["great", "okay", "bad"] as const;

export type Bucket = (typeof buckets)[number];

export type RankingPrompt =
  | { readonly type: "bucket"; readonly item: Item }
  | {
      readonly type: "compare";
      readonly item: Item;
      readonly against: Item;
    }
  | { readonly type: "done"; readonly item: RankedItem };

export type RankingAnswer =
  | { readonly bucket: Bucket }
  | { readonly better: boolean };

interface Bounds {
  readonly low: number;
  readonly high: number;
}

export function boundsForBucket(bucket: Bucket, itemCount: number): Bounds {
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    throw new Error("Bucket bounds require at least one ranked item");
  }

  switch (bucket) {
    case "great":
      return { low: 0, high: Math.ceil(itemCount / 3) };
    case "okay":
      return {
        low: Math.floor(itemCount / 3),
        high: Math.ceil((2 * itemCount) / 3),
      };
    case "bad":
      return { low: Math.floor((2 * itemCount) / 3), high: itemCount };
  }
}

export class RankingSession {
  readonly #item: Item;
  readonly #rankedItems: readonly Item[];
  #low = 0;
  #high = 0;
  #prompt: RankingPrompt;

  constructor(item: Item, rankedItems: readonly Item[]) {
    if (rankedItems.some(({ category }) => category !== item.category)) {
      throw new Error("All items in a ranking session must share a category");
    }
    if (rankedItems.some(({ id }) => id === item.id)) {
      throw new Error("The item being ranked is already in the ranked list");
    }

    this.#item = item;
    this.#rankedItems = [...rankedItems];
    this.#prompt =
      rankedItems.length === 0
        ? this.#donePrompt(0)
        : { type: "bucket", item: this.#item };
  }

  next(): RankingPrompt {
    return this.#prompt;
  }

  answer(answer: RankingAnswer): RankingPrompt {
    if (this.#prompt.type === "done") {
      throw new Error("This ranking session is already complete");
    }

    if (this.#prompt.type === "bucket") {
      if (!("bucket" in answer)) {
        throw new Error("The outstanding prompt requires a bucket answer");
      }

      const bounds = boundsForBucket(answer.bucket, this.#rankedItems.length);
      this.#low = bounds.low;
      this.#high = bounds.high;
      return this.#advance();
    }

    if (!("better" in answer)) {
      throw new Error("The outstanding prompt requires a comparison answer");
    }

    const middle = Math.floor((this.#low + this.#high) / 2);
    if (answer.better) {
      this.#high = middle;
    } else {
      this.#low = middle + 1;
    }

    return this.#advance();
  }

  #advance(): RankingPrompt {
    if (this.#low === this.#high) {
      this.#prompt = this.#donePrompt(this.#low);
      return this.#prompt;
    }

    const middle = Math.floor((this.#low + this.#high) / 2);
    const against = this.#rankedItems[middle];
    if (against === undefined) {
      throw new Error("Ranking bounds referenced a missing item");
    }

    this.#prompt = {
      type: "compare",
      item: this.#item,
      against,
    };
    return this.#prompt;
  }

  #donePrompt(index: number): RankingPrompt {
    const position = index + 1;
    return {
      type: "done",
      item: {
        ...this.#item,
        position,
        score: scoreForPosition(position, this.#rankedItems.length + 1),
      },
    };
  }
}
