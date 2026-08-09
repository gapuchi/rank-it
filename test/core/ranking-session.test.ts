import { describe, expect, it } from "vitest";

import {
  boundsForBucket,
  RankingSession,
} from "../../src/core/ranking-session.js";
import { scoreForPosition } from "../../src/core/score.js";
import { parseCategory, type Item } from "../../src/core/types.js";

function item(rank: number, category: Item["category"] = "movies"): Item {
  return {
    id: `item-${rank}`,
    category,
    title: `Item ${rank}`,
  };
}

describe("RankingSession", () => {
  it("places the first item without asking a question", () => {
    const session = new RankingSession(item(1), []);

    expect(session.next()).toEqual({
      type: "done",
      item: { ...item(1), position: 1, score: 10 },
    });
  });

  it("places an item using a bucket followed by binary comparisons", () => {
    const existing = Array.from({ length: 9 }, (_, index) => item(index + 1));
    const candidate = item(10);
    const session = new RankingSession(candidate, existing);

    expect(session.answer({ bucket: "okay" })).toMatchObject({
      type: "compare",
      against: item(5),
    });
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: item(4),
    });
    expect(session.answer({ better: false })).toEqual({
      type: "done",
      item: { ...candidate, position: 5, score: 5.6 },
    });
  });

  it("uses logarithmic comparisons inside a bucket", () => {
    const existing = Array.from({ length: 99 }, (_, index) => item(index + 1));
    const session = new RankingSession(item(100), existing);
    let prompt = session.answer({ bucket: "okay" });
    let comparisonCount = 0;

    while (prompt.type === "compare") {
      comparisonCount += 1;
      prompt = session.answer({ better: true });
    }

    expect(comparisonCount).toBeLessThanOrEqual(6);
  });

  it("rejects rankings that mix categories", () => {
    expect(
      () => new RankingSession(item(2, "movies"), [item(1, "tv-shows")]),
    ).toThrow("must share a category");
  });

  it("requires an answer matching the outstanding prompt", () => {
    const session = new RankingSession(item(2), [item(1)]);

    expect(() => session.answer({ better: true })).toThrow("bucket answer");
  });
});

describe("boundsForBucket", () => {
  it("uses overlapping thirds so every bucket remains usable", () => {
    expect(boundsForBucket("great", 9)).toEqual({ low: 0, high: 3 });
    expect(boundsForBucket("okay", 9)).toEqual({ low: 3, high: 6 });
    expect(boundsForBucket("bad", 9)).toEqual({ low: 6, high: 9 });
    expect(boundsForBucket("bad", 1)).toEqual({ low: 0, high: 1 });
  });
});

describe("scoreForPosition", () => {
  it("linearly interpolates scores from best to worst", () => {
    expect(scoreForPosition(1, 5)).toBe(10);
    expect(scoreForPosition(3, 5)).toBe(5);
    expect(scoreForPosition(5, 5)).toBe(0);
  });
});

describe("parseCategory", () => {
  it("accepts known categories and rejects unknown categories", () => {
    expect(parseCategory("video-games")).toBe("video-games");
    expect(() => parseCategory("books")).toThrow("Unknown category");
  });
});
