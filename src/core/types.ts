export const categories = ["movies", "tv-shows", "video-games"] as const;

export type Category = (typeof categories)[number];

export interface Item {
  readonly id: string;
  readonly category: Category;
  readonly title: string;
  readonly year?: number;
  readonly notes?: string;
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
