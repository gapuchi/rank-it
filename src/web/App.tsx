import { useEffect, useState, type FormEvent } from "react";

import type { RankingPrompt } from "../core/ranking-session";
import type { Category, RankedItem, User } from "../core/types";
import * as api from "./api";
import type { SessionStarted } from "./api";
import { AppHeader } from "./components/AppHeader";
import { CategoryTabs } from "./components/CategoryTabs";
import { RankingDialog } from "./components/RankingDialog";
import { RankingsPanel } from "./components/RankingsPanel";
import { useToast } from "./hooks/useToast";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [users, setUsers] = useState<readonly User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentCategory, setCurrentCategory] = useState<Category | null>(null);
  const [items, setItems] = useState<readonly RankedItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<RankingPrompt | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const { toast, showToast } = useToast();

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [listedUsers, listedCategories] = await Promise.all([
          api.listUsers(),
          api.listCategories(),
        ]);

        let loadedUsers = listedUsers;
        if (loadedUsers.length === 0) {
          loadedUsers = [await api.createUser("default")];
        }

        if (!cancelled) {
          setUsers(loadedUsers);
          setCurrentUserId(loadedUsers[0]?.id ?? null);
          setCategories(listedCategories);
          setCurrentCategory(listedCategories[0] ?? null);
        }
      } catch (error) {
        if (!cancelled) showToast(errorMessage(error), true);
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (currentUserId === null || currentCategory === null) {
      setItems([]);
      return;
    }

    let cancelled = false;
    api
      .listItems(currentUserId, currentCategory)
      .then((listedItems) => {
        if (!cancelled) setItems(listedItems);
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(errorMessage(error), true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentCategory, currentUserId, listVersion, showToast]);

  function finishSession(done: Extract<RankingPrompt, { type: "done" }>) {
    setPrompt(null);
    setSessionId(null);
    showToast(
      `Ranked "${done.item.title}" at #${done.item.position} (${done.item.score.toFixed(1)})`,
    );
    setListVersion((version) => version + 1);
  }

  function beginSession(started: SessionStarted) {
    if (started.prompt.type === "done") {
      finishSession(started.prompt);
      return;
    }
    setSessionId(started.sessionId);
    setPrompt(started.prompt);
  }

  async function createUser() {
    const name = window.prompt("New user name:");
    if (name === null || name.trim().length === 0) return;

    try {
      const created = await api.createUser(name.trim());
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
      const started = await api.addItem(
        currentUserId,
        currentCategory,
        title,
      );
      form.reset();
      beginSession(started);
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
      await api.deleteItem(currentUserId, currentCategory, item.id);
      showToast(`Deleted "${item.title}"`);
      setListVersion((version) => version + 1);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function startRerank(itemId: string) {
    if (currentUserId === null || currentCategory === null) return;

    try {
      const started = await api.rerankItem(
        currentUserId,
        currentCategory,
        itemId,
      );
      beginSession(started);
    } catch (error) {
      showToast(errorMessage(error), true);
    }
  }

  async function answer(better: boolean) {
    if (sessionId === null) return;

    try {
      const nextPrompt = await api.answerSession(sessionId, better);
      if (nextPrompt.type === "done") {
        finishSession(nextPrompt);
      } else {
        setPrompt(nextPrompt);
      }
    } catch (error) {
      setPrompt(null);
      setSessionId(null);
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
