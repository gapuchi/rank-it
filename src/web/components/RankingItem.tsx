import type { RankedItem } from "../../core/types";

interface RankingItemProps {
  readonly item: RankedItem;
  readonly onRerank: (itemId: string) => void;
  readonly onDelete: (item: RankedItem) => void;
}

export function RankingItem({
  item,
  onRerank,
  onDelete,
}: RankingItemProps) {
  return (
    <div className="item">
      <div className="rank">#{item.position}</div>
      <div className="item-main">
        <div className="item-title">{item.title}</div>
      </div>
      <div className="score">{item.score.toFixed(1)}</div>
      <div className="item-actions">
        <button
          className="ghost"
          type="button"
          onClick={() => onRerank(item.id)}
        >
          Re-rank
        </button>
        <button
          className="ghost danger"
          type="button"
          onClick={() => onDelete(item)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
