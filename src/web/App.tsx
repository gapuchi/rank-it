import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  CatalogService,
  categories,
  type CatalogRankingSession,
} from "../core/index";
import type { RankingPrompt } from "../core/ranking-session";
import type { Category, RankedItem, User } from "../core/types";
import { HttpCatalogRepository } from "../http/http-catalog-repository";
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
  const catalogService = useMemo(
    () => new CatalogService(catalogRepository, () => crypto.randomUUID()),
    [catalogRepository],
  );
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

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentUserId === null || currentCategory === null) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = String(formData.get("title") ?? "").trim();
    if (title.length === 0) {
      showToast("A title is required", true);
      return;
    }

    try {
      const session = await catalogService.addItem({
        userId: currentUserId,
        category: currentCategory,
        title,
      });
      form.reset();
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
        onAddItem={addItem}
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
