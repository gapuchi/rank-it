export const categories = ["movies", "tv-shows", "video-games"] as const;

export type Category = (typeof categories)[number];

export interface User {
  readonly id: string;
  readonly name: string;
}

export interface Item {
  readonly id: string;
  readonly category: Category;
  readonly title: string;
  /** Name of the external database that confirmed this title, if any. */
  readonly source?: string;
  /** Identifier of the confirmed entry within `source`. */
  readonly sourceId?: string;
}

export interface RankedItem extends Item {
  readonly position: number;
  readonly score: number;
}

export function parseCategory(value: string): Category {
  if (categories.some((category) => category === value)) {
    return value as Category;
  }

  throw new Error(
    `Unknown category "${value}". Expected one of: ${categories.join(", ")}`,
  );
}
