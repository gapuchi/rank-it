import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CatalogService,
  categories,
  type CatalogRankingSession,
} from "../core/index";
import type { MetadataMatch } from "../core/metadata";
import type { RankingPrompt } from "../core/ranking-session";
import type { Category, RankedItem, User } from "../core/types";
import { HttpCatalogRepository } from "../http/http-catalog-repository";
import {
  fetchMetadataCapabilities,
  HttpMetadataProvider,
} from "../http/http-metadata-provider";
import { HttpUserRepository } from "../http/http-user-repository";
import { AppHeader } from "./components/AppHeader";
import { CategoryTabs } from "./components/CategoryTabs";
import { RankingDialog } from "./components/RankingDialog";
import { RankingsPanel } from "./components/RankingsPanel";
import { useToast } from "./hooks/useToast";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const catalogRepository = useMemo(() => new HttpCatalogRepository(), []);
  const userRepository = useMemo(() => new HttpUserRepository(), []);
  const [searchableCategories, setSearchableCategories] = useState<
    readonly Category[]
  >([]);
  const [providerName, setProviderName] = useState<string | null>(null);

  // The server holds the title-database credentials, so the browser reaches it
  // through an HTTP provider and only when the server reports it is available.
  const catalogService = useMemo(() => {
    const metadataProvider =
      searchableCategories.length === 0
        ? undefined
        : new HttpMetadataProvider({
            searchableCategories,
            ...(providerName === null ? {} : { name: providerName }),
          });

    return new CatalogService(
      catalogRepository,
      () => crypto.randomUUID(),
      metadataProvider === undefined ? {} : { metadataProvider },
    );
  }, [catalogRepository, providerName, searchableCategories]);
  const rankingSessionRef = useRef<CatalogRankingSession | null>(null);

  const [users, setUsers] = useState<readonly User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentCategory, setCurrentCategory] = useState<Category | null>(null);
  const [items, setItems] = useState<readonly RankedItem[]>([]);
  const [prompt, setPrompt] = useState<RankingPrompt | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const { toast, showToast } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        let listedUsers = await userRepository.listUsers();
        if (listedUsers.length === 0) {
          listedUsers = [await userRepository.createUser("default")];
        }

        if (!cancelled) {
          setUsers(listedUsers);
          setCurrentUserId(listedUsers[0]?.id ?? null);
          setCurrentCategory(categories[0] ?? null);
        }

        // Title search is optional; its absence must not block the app.
        const capabilities = await fetchMetadataCapabilities().catch(() => null);
        if (!cancelled && capabilities !== null) {
          setSearchableCategories(capabilities.searchableCategories);
          setProviderName(capabilities.name);
        }
      } catch (error) {
        if (!cancelled) showToast(errorMessage(error), true);
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [showToast, userRepository]);

  useEffect(() => {
    if (currentUserId === null || currentCategory === null) {
      setItems([]);
      return;
    }

    let cancelled = false;
    catalogService
      .list(currentUserId, currentCategory)
      .then((listedItems) => {
        if (!cancelled) setItems(listedItems);
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(errorMessage(error), true);
      });

    return () => {
      cancelled = true;
    };
  }, [catalogService, currentCategory, currentUserId, listVersion, showToast]);

  function finishSession(done: Extract<RankingPrompt, { type: "done" }>) {
    rankingSessionRef.current = null;
    setPrompt(null);
    showToast(
      `Ranked "${done.item.title}" at #${done.item.position} (${done.item.score.toFixed(1)})`,
    );
    setListVersion((version) => version + 1);
  }

  function beginSession(session: CatalogRankingSession) {
    rankingSessionRef.current = session;
    const firstPrompt = session.next();
    if (firstPrompt.type === "done") {
      finishSession(firstPrompt);
      return;
    }
    setPrompt(firstPrompt);
  }

  async function createUser() {
    const name = window.prompt("New user name:");
    if (name === null || name.trim().length === 0) return;

    try {
      const created = await userRepository.createUser(name.trim());
      setUsers((current) => [...current, created]);
      setCurrentUserId(created.id);
      showToast(`Created user "${created.name}"`);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function addManual(title: string) {
    if (currentUserId === null || currentCategory === null) return;

    try {
      const session = await catalogService.addItem({
        userId: currentUserId,
        category: currentCategory,
        title,
      });
      beginSession(session);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  const searchTitles = useCallback(
    async (query: string): Promise<readonly MetadataMatch[]> => {
      if (currentCategory === null) return [];
      return catalogService.searchMetadata(currentCategory, query, { limit: 5 });
    },
    [catalogService, currentCategory],
  );

  async function pickMatch(match: MetadataMatch) {
    if (currentUserId === null || currentCategory === null) return;

    try {
      const session = await catalogService.addMatchedItem({
        userId: currentUserId,
        category: currentCategory,
        source: match.source,
        sourceId: match.sourceId,
      });
      beginSession(session);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function deleteItem(item: RankedItem) {
    if (
      currentUserId === null ||
      currentCategory === null ||
      !window.confirm(`Delete "${item.title}"?`)
    ) {
      return;
    }

    try {
      await catalogService.delete(currentUserId, currentCategory, item.id);
      showToast(`Deleted "${item.title}"`);
      setListVersion((version) => version + 1);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function startRerank(itemId: string) {
    if (currentUserId === null || currentCategory === null) return;

    try {
      const session = await catalogService.rerank(
        currentUserId,
        currentCategory,
        itemId,
      );
      beginSession(session);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function answer(better: boolean) {
    const session = rankingSessionRef.current;
    if (session === null) return;

    try {
      const nextPrompt = await session.answer({ better });
      if (nextPrompt.type === "done") {
        finishSession(nextPrompt);
      } else {
        setPrompt(nextPrompt);
      }
    } catch (error) {
      rankingSessionRef.current = null;
      setPrompt(null);
      showToast(errorMessage(error), true);
    }
  }

  return (
    <>
      <AppHeader
        users={users}
        currentUserId={currentUserId}
        onSelectUser={setCurrentUserId}
        onCreateUser={() => void createUser()}
      />
      <CategoryTabs
        categories={categories}
        currentCategory={currentCategory}
        onSelectCategory={setCurrentCategory}
      />
      <RankingsPanel
        items={items}
        searchable={
          currentCategory !== null &&
          catalogService.supportsMetadata(currentCategory)
        }
        onAddManual={(title) => void addManual(title)}
        onSearch={searchTitles}
        onPickMatch={(match) => void pickMatch(match)}
        onRerankItem={(itemId) => void startRerank(itemId)}
        onDeleteItem={(item) => void deleteItem(item)}
      />

      {prompt?.type === "compare" && (
        <RankingDialog
          prompt={prompt}
          onAnswer={(better) => void answer(better)}
        />
      )}

      {toast !== null && (
        <div
          className={`toast${toast.isError ? " error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
