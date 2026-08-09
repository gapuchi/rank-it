import { scoreForPosition } from "./score.js";
import type { Item, RankedItem } from "./types.js";

export type RankingPrompt =
  | {
      readonly type: "compare";
      readonly item: Item;
      readonly against: Item;
    }
  | { readonly type: "done"; readonly item: RankedItem };

export type RankingAnswer = { readonly better: boolean };

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
    if (rankedItems.length === 0) {
      this.#prompt = this.#donePrompt(0);
    } else {
      this.#low = 0;
      this.#high = rankedItems.length;
      this.#prompt = this.#advance();
    }
  }

  next(): RankingPrompt {
    return this.#prompt;
  }

  answer(answer: RankingAnswer): RankingPrompt {
    if (this.#prompt.type === "done") {
      throw new Error("This ranking session is already complete");
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
