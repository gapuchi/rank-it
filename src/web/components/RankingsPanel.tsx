import type { FormEvent } from "react";

import type { RankedItem } from "../../core/types";
import { RankingItem } from "./RankingItem";

interface RankingsPanelProps {
  readonly items: readonly RankedItem[];
  readonly onAddItem: (event: FormEvent<HTMLFormElement>) => void;
  readonly onRerankItem: (itemId: string) => void;
  readonly onDeleteItem: (item: RankedItem) => void;
}

export function RankingsPanel({
  items,
  onAddItem,
  onRerankItem,
  onDeleteItem,
}: RankingsPanelProps) {
  return (
    <main className="content">
      <section className="add-panel">
        <form id="add-form" autoComplete="off" onSubmit={onAddItem}>
          <input
            name="title"
            type="text"
            placeholder="Title"
            required
            aria-label="Title"
          />
          <button type="submit">Add &amp; rank</button>
        </form>
      </section>

      <section className="list-panel" aria-live="polite">
        {items.length === 0 ? (
          <div className="empty">
            Nothing ranked yet. Add something above to get started.
          </div>
        ) : (
          items.map((item) => (
            <RankingItem
              key={item.id}
              item={item}
              onRerank={onRerankItem}
              onDelete={onDeleteItem}
            />
          ))
        )}
      </section>
    </main>
  );
}
