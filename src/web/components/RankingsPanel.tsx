import type { MetadataMatch } from "../../core/metadata";
import type { RankedItem } from "../../core/types";
import { AddPanel } from "./AddPanel";
import { RankingItem } from "./RankingItem";

interface RankingsPanelProps {
  readonly items: readonly RankedItem[];
  readonly searchable: boolean;
  readonly onAddManual: (title: string) => void;
  readonly onSearch: (query: string) => Promise<readonly MetadataMatch[]>;
  readonly onPickMatch: (match: MetadataMatch) => void;
  readonly onRerankItem: (itemId: string) => void;
  readonly onDeleteItem: (item: RankedItem) => void;
}

export function RankingsPanel({
  items,
  searchable,
  onAddManual,
  onSearch,
  onPickMatch,
  onRerankItem,
  onDeleteItem,
}: RankingsPanelProps) {
  return (
    <main className="content">
      <AddPanel
        searchable={searchable}
        onAddManual={onAddManual}
        onSearch={onSearch}
        onPickMatch={onPickMatch}
      />

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
