const state = {
  categories: [],
  users: [],
  currentUser: null,
  current: null,
  session: null,
};

const tabsEl = document.getElementById("tabs");
const listEl = document.getElementById("list-panel");
const formEl = document.getElementById("add-form");
const overlayEl = document.getElementById("ranking-overlay");
const modalBodyEl = document.getElementById("modal-body");
const modalTitleEl = document.getElementById("modal-title");
const toastEl = document.getElementById("toast");
const userSelectEl = document.getElementById("user-select");
const addUserEl = document.getElementById("add-user");

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}

function categoryLabel(category) {
  return category
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("error", isError);
  toastEl.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

function renderUsers() {
  userSelectEl.replaceChildren();
  for (const user of state.users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.name;
    option.selected = user.id === state.currentUser;
    userSelectEl.appendChild(option);
  }
}

function renderTabs() {
  tabsEl.replaceChildren();
  for (const category of state.categories) {
    const tab = document.createElement("button");
    tab.className = "tab" + (category === state.current ? " active" : "");
    tab.textContent = categoryLabel(category);
    tab.addEventListener("click", () => {
      state.current = category;
      renderTabs();
      void loadList();
    });
    tabsEl.appendChild(tab);
  }
}

function renderItems(items) {
  listEl.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "Nothing ranked yet. Add something above to get started.";
    listEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item";

    const rank = document.createElement("div");
    rank.className = "rank";
    rank.textContent = `#${item.position}`;

    const main = document.createElement("div");
    main.className = "item-main";
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = item.title;
    main.appendChild(title);

    const score = document.createElement("div");
    score.className = "score";
    score.textContent = item.score.toFixed(1);

    const actions = document.createElement("div");
    actions.className = "item-actions";
    const rerankBtn = document.createElement("button");
    rerankBtn.className = "ghost";
    rerankBtn.textContent = "Re-rank";
    rerankBtn.addEventListener("click", () => void startRerank(item.id));
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => void deleteItem(item));
    actions.append(rerankBtn, deleteBtn);

    row.append(rank, main, score, actions);
    listEl.appendChild(row);
  }
}

function itemsPath() {
  return `/users/${state.currentUser}/categories/${state.current}/items`;
}

async function loadUsers() {
  const data = await api("/users");
  state.users = data.users;

  if (state.users.length === 0) {
    const created = await api("/users", {
      method: "POST",
      body: JSON.stringify({ name: "default" }),
    });
    state.users = [created.user];
  }

  state.currentUser = state.users[0]?.id ?? null;
  renderUsers();
}

async function loadCategories() {
  const data = await api("/categories");
  state.categories = data.categories;
  state.current = data.categories[0] ?? null;
  renderTabs();
}

async function loadList() {
  if (state.current === null || state.currentUser === null) return;
  try {
    const data = await api(itemsPath());
    renderItems(data.items);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteItem(item) {
  if (!confirm(`Delete "${item.title}"?`)) return;
  try {
    await api(`${itemsPath()}/${item.id}`, { method: "DELETE" });
    showToast(`Deleted "${item.title}"`);
    await loadList();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function startRerank(itemId) {
  try {
    const data = await api(`${itemsPath()}/${itemId}/rerank`, {
      method: "POST",
    });
    beginSession(data);
  } catch (error) {
    showToast(error.message, true);
  }
}

function beginSession(started) {
  state.session = started.sessionId;
  if (started.prompt.type === "done") {
    finishSession(started.prompt);
    return;
  }
  overlayEl.hidden = false;
  renderPrompt(started.prompt);
}

async function answer(better) {
  if (state.session === null) return;
  try {
    const data = await api(`/sessions/${state.session}/answer`, {
      method: "POST",
      body: JSON.stringify({ better }),
    });
    if (data.prompt.type === "done") {
      finishSession(data.prompt);
    } else {
      renderPrompt(data.prompt);
    }
  } catch (error) {
    overlayEl.hidden = true;
    state.session = null;
    showToast(error.message, true);
  }
}

function finishSession(prompt) {
  overlayEl.hidden = true;
  state.session = null;
  showToast(
    `Ranked "${prompt.item.title}" at #${prompt.item.position} (${prompt.item.score.toFixed(1)})`,
  );
  void loadList();
}

function renderPrompt(prompt) {
  modalBodyEl.replaceChildren();
  if (prompt.type !== "compare") return;

  modalTitleEl.textContent = "Which is better?";
  const question = document.createElement("p");
  question.className = "prompt-question";
  question.textContent = "Pick the one you liked more.";
  const choices = document.createElement("div");
  choices.className = "choices";

  const mine = document.createElement("button");
  mine.className = "compare-card";
  mine.textContent = prompt.item.title;
  mine.addEventListener("click", () => void answer(true));

  const vs = document.createElement("span");
  vs.className = "compare-vs";
  vs.textContent = "vs";

  const against = document.createElement("button");
  against.className = "compare-card";
  against.textContent = prompt.against.title;
  against.addEventListener("click", () => void answer(false));

  choices.append(mine, vs, against);
  modalBodyEl.append(question, choices);
}

userSelectEl.addEventListener("change", () => {
  state.currentUser = userSelectEl.value;
  void loadList();
});

addUserEl.addEventListener("click", async () => {
  const name = prompt("New user name:");
  if (name === null || name.trim().length === 0) return;
  try {
    const created = await api("/users", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    state.users = [...state.users, created.user];
    state.currentUser = created.user.id;
    renderUsers();
    showToast(`Created user "${created.user.name}"`);
    await loadList();
  } catch (error) {
    showToast(error.message, true);
  }
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.current === null || state.currentUser === null) return;

  const titleEl = document.getElementById("title");
  const title = titleEl.value.trim();
  if (title.length === 0) {
    showToast("A title is required", true);
    return;
  }

  try {
    const data = await api(itemsPath(), {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    formEl.reset();
    beginSession(data);
  } catch (error) {
    showToast(error.message, true);
  }
});

async function init() {
  try {
    await loadUsers();
    await loadCategories();
    await loadList();
  } catch (error) {
    showToast(error.message, true);
  }
}

void init();
