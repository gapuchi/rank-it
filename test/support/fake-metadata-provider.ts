import type {
  Category,
  MetadataMatch,
  MetadataProvider,
} from "../../src/core/index.js";

export const fakeMatches: readonly MetadataMatch[] = [
  {
    source: "fake-db",
    sourceId: "1",
    title: "Arrival",
    year: 2016,
    posterUrl: "https://images.test/arrival.jpg",
  },
  { source: "fake-db", sourceId: "2", title: "Arrival of the Sequel", year: 2020 },
];

/** Deterministic stand-in for a real title database. */
export function createFakeMetadataProvider(
  matches: readonly MetadataMatch[] = fakeMatches,
): MetadataProvider {
  return {
    name: "fake-db",
    supports: (category: Category) =>
      category === "movies" || category === "tv-shows",
    async search(_category, query, options) {
      const needle = query.toLowerCase();
      return matches
        .filter((match) => match.title.toLowerCase().includes(needle))
        .slice(0, options?.limit ?? 5);
    },
    async lookup(_category, sourceId) {
      return matches.find((match) => match.sourceId === sourceId);
    },
  };
}
