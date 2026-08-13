import type { Category } from "../../core/types";

interface CategoryTabsProps {
  readonly categories: readonly Category[];
  readonly currentCategory: Category | null;
  readonly onSelectCategory: (category: Category) => void;
}

function categoryLabel(category: Category): string {
  return category
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function CategoryTabs({
  categories,
  currentCategory,
  onSelectCategory,
}: CategoryTabsProps) {
  return (
    <nav className="tabs" aria-label="Categories">
      {categories.map((category) => (
        <button
          key={category}
          className={`tab${category === currentCategory ? " active" : ""}`}
          type="button"
          onClick={() => onSelectCategory(category)}
        >
          {categoryLabel(category)}
        </button>
      ))}
    </nav>
  );
}
