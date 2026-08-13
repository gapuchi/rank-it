import type {
  Category,
  MetadataMatch,
  MetadataProvider,
  MetadataSearchOptions,
} from "../core/index.js";

export const tmdbSource = "tmdb";

export interface TmdbMetadataProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly imageBaseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

interface TmdbTitle {
  readonly id?: number;
  readonly title?: string;
  readonly name?: string;
  readonly release_date?: string;
  readonly first_air_date?: string;
  readonly overview?: string;
  readonly poster_path?: string | null;
}

interface TmdbSearchResponse {
  readonly results?: readonly TmdbTitle[];
}

const defaultBaseUrl = "https://api.themoviedb.org/3";
const defaultImageBaseUrl = "https://image.tmdb.org/t/p/w200";
const defaultLimit = 5;

/** TMDB uses separate endpoints for films and series. */
const paths: Partial<Record<Category, string>> = {
  movies: "movie",
  "tv-shows": "tv",
};

export function createTmdbMetadataProvider(
  options: TmdbMetadataProviderOptions,
): MetadataProvider {
  const apiKey = options.apiKey.trim();
  if (apiKey.length === 0) {
    throw new Error("A TMDB API key is required");
  }

  const baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/$/, "");
  const imageBaseUrl = (options.imageBaseUrl ?? defaultImageBaseUrl).replace(
    /\/$/,
    "",
  );
  const doFetch = options.fetch ?? globalThis.fetch;
  // v4 read access tokens are JWTs and use bearer auth; v3 keys use a query
  // parameter.
  const usesBearerToken = apiKey.split(".").length === 3;

  async function request(
    path: string,
    query: Record<string, string> = {},
  ): Promise<unknown | undefined> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    if (!usesBearerToken) {
      url.searchParams.set("api_key", apiKey);
    }

    const response = await doFetch(url, {
      headers: {
        accept: "application/json",
        ...(usesBearerToken ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });

    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `TMDB request failed with status ${response.status}`,
      );
    }
    return response.json();
  }

  function toMatch(result: TmdbTitle): MetadataMatch | undefined {
    const title = result.title ?? result.name;
    if (result.id === undefined || title === undefined) {
      return undefined;
    }

    const releaseDate = result.release_date ?? result.first_air_date ?? "";
    const year = Number.parseInt(releaseDate.slice(0, 4), 10);
    const overview = result.overview?.trim();
    return {
      source: tmdbSource,
      sourceId: String(result.id),
      title,
      ...(Number.isInteger(year) ? { year } : {}),
      ...(overview === undefined || overview.length === 0 ? {} : { overview }),
      ...(result.poster_path
        ? { posterUrl: `${imageBaseUrl}${result.poster_path}` }
        : {}),
    };
  }

  function requirePath(category: Category): string {
    const path = paths[category];
    if (path === undefined) {
      throw new Error(`TMDB does not cover ${category}`);
    }
    return path;
  }

  return {
    name: tmdbSource,

    supports(category) {
      return paths[category] !== undefined;
    },

    async search(
      category: Category,
      query: string,
      searchOptions?: MetadataSearchOptions,
    ) {
      const path = requirePath(category);
      const body = (await request(`/search/${path}`, {
        query,
        include_adult: "false",
        page: "1",
      })) as TmdbSearchResponse | undefined;

      const results = body?.results ?? [];
      const limit = searchOptions?.limit ?? defaultLimit;
      return results
        .map(toMatch)
        .filter((match): match is MetadataMatch => match !== undefined)
        .slice(0, limit);
    },

    async lookup(category: Category, sourceId: string) {
      const path = requirePath(category);
      if (!/^\d+$/.test(sourceId)) {
        return undefined;
      }

      const body = (await request(`/${path}/${sourceId}`)) as
        | TmdbTitle
        | undefined;
      return body === undefined ? undefined : toMatch(body);
    },
  };
}

/**
 * Builds a provider when a TMDB key is present. Without one the app keeps
 * working with unverified, hand-entered titles.
 */
export function createTmdbMetadataProviderFromEnvironment(
  environment: NodeJS.ProcessEnv,
): MetadataProvider | undefined {
  const apiKey = environment.TMDB_API_KEY ?? environment.RANK_IT_TMDB_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    return undefined;
  }

  return createTmdbMetadataProvider({ apiKey });
}
