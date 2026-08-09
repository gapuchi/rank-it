import { describe, expect, it } from "vitest";

import { RankingSession } from "../../src/core/ranking-session.js";
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

  it("places an item using binary comparisons across the full list", () => {
    const existing = Array.from({ length: 9 }, (_, index) => item(index + 1));
    const candidate = item(10);
    const session = new RankingSession(candidate, existing);

    expect(session.next()).toMatchObject({
      type: "compare",
      against: item(5),
    });
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: item(3),
    });
    expect(session.answer({ better: false })).toMatchObject({
      type: "compare",
      against: item(4),
    });
    expect(session.answer({ better: false })).toEqual({
      type: "done",
      item: { ...candidate, position: 5, score: 5.6 },
    });
  });

  it("compares against the only existing item when adding a second", () => {
    const session = new RankingSession(item(2), [item(1)]);

    expect(session.next()).toMatchObject({
      type: "compare",
      against: item(1),
    });
    expect(session.answer({ better: true })).toEqual({
      type: "done",
      item: { ...item(2), position: 1, score: 10 },
    });
  });

  it("compares against the second game when adding a third after ranking great", () => {
    const existing = [item(1), item(2)];
    const candidate = item(3);
    const session = new RankingSession(candidate, existing);

    expect(session.next()).toMatchObject({
      type: "compare",
      against: item(2),
    });
    expect(session.answer({ better: true })).toMatchObject({
      type: "compare",
      against: item(1),
    });
  });

  it("uses logarithmic comparisons for large lists", () => {
    const existing = Array.from({ length: 99 }, (_, index) => item(index + 1));
    const session = new RankingSession(item(100), existing);
    let prompt = session.next();
    let comparisonCount = 0;

    while (prompt.type === "compare") {
      comparisonCount += 1;
      prompt = session.answer({ better: true });
    }

    expect(comparisonCount).toBeLessThanOrEqual(7);
  });

  it("rejects rankings that mix categories", () => {
    expect(
      () => new RankingSession(item(2, "movies"), [item(1, "tv-shows")]),
    ).toThrow("must share a category");
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
