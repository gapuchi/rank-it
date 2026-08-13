import { useEffect, useRef, useState, type FormEvent } from "react";

import type { MetadataMatch } from "../../core/metadata";

interface AddPanelProps {
  readonly searchable: boolean;
  readonly onAddManual: (title: string) => void;
  readonly onSearch: (query: string) => Promise<readonly MetadataMatch[]>;
  readonly onPickMatch: (match: MetadataMatch) => void;
}

export function AddPanel({
  searchable,
  onAddManual,
  onSearch,
  onPickMatch,
}: AddPanelProps) {
  const [title, setTitle] = useState("");
  const [suggestions, setSuggestions] = useState<readonly MetadataMatch[]>([]);
  const requestId = useRef(0);

  // Debounced title search; only the latest request is allowed to render.
  useEffect(() => {
    if (!searchable) {
      setSuggestions([]);
      return;
    }
    const query = title.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      onSearch(query)
        .then((matches) => {
          if (id === requestId.current) setSuggestions(matches);
        })
        .catch(() => {
          if (id === requestId.current) setSuggestions([]);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [title, searchable, onSearch]);

  function hideSuggestions() {
    requestId.current += 1;
    setSuggestions([]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    hideSuggestions();
    onAddManual(trimmed);
    setTitle("");
  }

  function pick(match: MetadataMatch) {
    hideSuggestions();
    setTitle("");
    onPickMatch(match);
  }

  return (
    <section className="add-panel">
      <form id="add-form" autoComplete="off" onSubmit={submit}>
        <div className="title-field">
          <input
            name="title"
            type="text"
            placeholder="Title"
            required
            aria-label="Title"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="suggestions"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") hideSuggestions();
            }}
          />
          {suggestions.length > 0 && (
            <ul id="suggestions" className="suggestions" role="listbox">
              {suggestions.map((match) => (
                <li key={`${match.source}:${match.sourceId}`} role="option">
                  <button
                    type="button"
                    className="suggestion"
                    onClick={() => pick(match)}
                  >
                    {match.posterUrl !== undefined && (
                      <img src={match.posterUrl} alt="" />
                    )}
                    <span>
                      {match.title}
                      {match.year !== undefined && (
                        <span className="year"> ({match.year})</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit">Add &amp; rank</button>
      </form>
      {searchable && (
        <p className="add-hint">
          Start typing to pick a confirmed title, or submit to add it as typed.
        </p>
      )}
    </section>
  );
}
