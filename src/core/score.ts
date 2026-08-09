export function scoreForPosition(position: number, itemCount: number): number {
  if (!Number.isInteger(itemCount) || itemCount < 1) {
    throw new Error("Item count must be a positive integer");
  }
  if (!Number.isInteger(position) || position < 1 || position > itemCount) {
    throw new Error("Position must identify an item in the ranked list");
  }

  if (itemCount === 1) {
    return 10;
  }

  const score = (10 * (itemCount - position)) / (itemCount - 1);
  return Math.round(score * 10) / 10;
}
