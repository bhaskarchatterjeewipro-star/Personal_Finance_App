import { deleteRecord, keepMainBankAccount, openDatabase, readAll, replaceAll, seedStore, storeNames, writeRecord } from "./db.js";
import {
  amountToMinor, closeDialog, DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, filterTransactions,
  getMonthTotals, monthKey, openDialog, OVERALL_BUDGET_CATEGORY_ID, PALETTE, parseCsv,
} from "./utils.js";
import { renderBudgets, renderPlanning, renderSettings, renderTransactions } from "./ui.js";
import { renderDashboard } from "./ui-dashboard.js";
import { createBudgetDialog, createContributionDialog, createGoalDialog, createOverallBudgetDialog, createRecurringDialog } from "./forms.js";
import { processRecurring } from "./recurring.js";
import { exportCsv, exportJson, importCsv, openCsvImport, renderCsvMapping, restoreJson } from "./backup.js";
import { deleteCategory, reassignCategory } from "./category-actions.js";

const root = document.querySelector("#view-root");
const shell = document.querySelector(".app-shell");
const transactionDialog = document.querySelector("#transaction-dialog");
const csvDialog = document.querySelector("#csv-dialog");
const categoryDialog = document.querySelector("#category-dialog");
const state = {
  database: null, view: "dashboard", selectedMonth: monthKey(new Date()), transactions: [], categories: [],
  budgets: [], accounts: [], goals: [], recurring: [], settings: readSettings(), filters: { query: "", categoryId: "", accountId: "", dateFrom: "", dateTo: "" },
  listLimit: 50, currentType: "expense", editingId: null, csvData: null, pendingCategoryId: null,
};
let toastTimer;
let lastUndo;

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("paisa-settings") || "{}");
    const theme = saved.theme === "dark" ? "dark" : "light";
    const currency = ["INR", "USD", "EUR", "GBP", "SGD", "AUD"].includes(saved.currency) ? saved.currency : "INR";
    const locale = ["en-IN", "en-US", "en-GB"].includes(saved.locale) ? saved.locale : "en-IN";
    return { theme, currency, locale, schemaVersion: 1 };
  } catch (error) {
    console.warn("Could not read Paisa preferences; using defaults.", error);
    return { theme: "light", currency: "INR", locale: "en-IN", schemaVersion: 1 };
  }
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function persistSettings() {
  localStorage.setItem("paisa-settings", JSON.stringify(state.settings));
}

const appServices = { writeRecord, keepMainBankAccount, reloadData, render, showToast, localDateString, persistSettings };

function render() {
  root.replaceChildren();
  const views = {
    dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets,
    planning: renderPlanning, settings: renderSettings,
  };
  (views[state.view] ?? renderDashboard)(state, root);
  const labels = { dashboard: "Overview", transactions: "Transactions", budgets: "Budgets", planning: "Goals & bills", settings: "Settings" };
  document.querySelector("#page-label").textContent = labels[state.view] ?? "Overview";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
    if (button.dataset.view === state.view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelector("#currency-prefix").textContent = new Intl.NumberFormat(state.settings.locale, { style: "currency", currency: state.settings.currency }).formatToParts(0).find((part) => part.type === "currency")?.value ?? state.settings.currency;
  shell.classList.toggle("is-dark", state.settings.theme === "dark");
  document.body.classList.toggle("is-dark", state.settings.theme === "dark");
}

async function reloadData() {
  for (const store of storeNames) state[store] = await readAll(state.database, store);
  state.monthTotals = getMonthTotals(state.transactions, state.selectedMonth);
  state.filteredTransactions = filterTransactions(state.transactions, {
    ...state.filters,
    categoryNames: Object.fromEntries(state.categories.map((item) => [item.id, item.name])),
    accountNames: Object.fromEntries(state.accounts.map((item) => [item.id, item.name])),
  });
}

function showToast(message, undo = null) {
  const toast = document.querySelector("#toast");
  toast.replaceChildren();
  toast.append(document.createTextNode(message));
  if (undo) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = "Undo"; button.addEventListener("click", undo, { once: true });
    toast.append(button);
  }
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4000);
}

function transactionCategories(type) {
  return state.categories.filter((item) => item.type === type || item.type === "both");
}

function updateTransactionOptions() {
  const categorySelect = document.querySelector("#transaction-category");
  categorySelect.replaceChildren();
  for (const item of transactionCategories(state.currentType)) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.icon}  ${item.name}`;
    categorySelect.append(option);
  }
  const accountSelect = document.querySelector("#transaction-account");
  accountSelect.replaceChildren();
  for (const item of state.accounts) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; accountSelect.append(option);
  }
}

function openTransaction(id = null, defaults = {}) {
  state.editingId = id;
  const editing = state.transactions.find((item) => item.id === id);
  const form = document.querySelector("#transaction-form");
  form.reset();
  state.currentType = editing?.type ?? defaults.type ?? "expense";
  document.querySelector("#transaction-title").textContent = editing ? "Edit transaction" : "New transaction";
  document.querySelectorAll(".type-switch button").forEach((button) => button.classList.toggle("is-selected", button.dataset.type === state.currentType));
  updateTransactionOptions();
  const actions = form.querySelector(".modal-actions");
  actions.querySelector(".delete-current")?.remove();
  if (editing) {
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "button button-quiet delete-current"; remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Delete this transaction? This cannot be undone.")) return;
      await deleteRecord(state.database, "transactions", editing.id);
      closeDialog(transactionDialog); await reloadData(); render(); showToast("Transaction deleted.");
    });
    actions.prepend(remove);
  }
  document.querySelector("#transaction-amount").value = editing ? (editing.amountMinor / 100).toFixed(2) : defaults.amount ?? "";
  document.querySelector("#transaction-category").value = editing?.categoryId ?? defaults.categoryId ?? transactionCategories(state.currentType)[0]?.id ?? "";
  document.querySelector("#transaction-date").value = editing?.date ?? defaults.date ?? localDateString();
  document.querySelector("#transaction-account").value = editing?.accountId ?? state.accounts[0]?.id ?? "";
  document.querySelector("#transaction-note").value = editing?.note ?? defaults.note ?? "";
  openDialog(transactionDialog);
  const focusAmount = () => document.querySelector("#transaction-amount")?.focus();
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusAmount);
  else setTimeout(focusAmount, 0);
}

async function saveTransaction(event) {
  event.preventDefault();
  const form = event.target;
  const amountMinor = amountToMinor(form.elements.amount.value);
  if (!amountMinor) { form.elements.amount.setCustomValidity("Enter a valid amount greater than zero."); form.reportValidity(); form.elements.amount.setCustomValidity(""); return; }
  const existing = state.transactions.find((item) => item.id === state.editingId);
  const now = new Date().toISOString();
  const transaction = {
    id: existing?.id ?? crypto.randomUUID(), type: state.currentType, amountMinor,
    date: form.elements.date.value, categoryId: form.elements.categoryId.value,
    accountId: form.elements.accountId.value, note: form.elements.note.value.trim(),
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  await writeRecord(state.database, "transactions", transaction);
  closeDialog(transactionDialog); await reloadData(); render();
  if (!existing) {
    lastUndo = transaction.id;
    showToast("Transaction saved.", async () => {
      if (lastUndo !== transaction.id) return;
      await deleteRecord(state.database, "transactions", transaction.id);
      lastUndo = null; await reloadData(); render(); showToast("Transaction undone.");
    });
  } else showToast("Changes saved.");
}

async function handleClick(event) {
  const target = event.target.closest("[data-action], [data-view]");
  if (!target) return;
  if (target.dataset.view) { event.preventDefault(); state.view = target.dataset.view; state.listLimit = 50; render(); return; }
  const action = target.dataset.action;
  if (action === "close-dialog") closeDialog(target.closest("dialog"));
  else if (action === "add-transaction") openTransaction();
  else if (action === "edit-transaction") openTransaction(target.dataset.id);
  else if (action === "show-transactions") { state.view = "transactions"; render(); }
  else if (action === "show-more") { state.listLimit += 50; render(); }
  else if (action === "add-budget") createBudgetDialog(state, "", appServices);
  else if (action === "edit-budget") createBudgetDialog(state, target.dataset.categoryId, appServices);
  else if (action === "set-overall-budget") createOverallBudgetDialog(state, appServices);
  else if (action === "add-goal") createGoalDialog(state, appServices);
  else if (action === "add-recurring") createRecurringDialog(state, appServices);
  else if (action === "contribute-goal") createContributionDialog(state, target.dataset.id, appServices);
  else if (action === "delete-goal" && window.confirm("Delete this savings goal?")) { await deleteRecord(state.database, "goals", target.dataset.id); await reloadData(); render(); showToast("Goal deleted."); }
  else if (action === "delete-recurring" && window.confirm("Delete this recurring rule? Past transactions will remain.")) { await deleteRecord(state.database, "recurring", target.dataset.id); await reloadData(); render(); showToast("Recurring rule deleted."); }
  else if (action === "export-json") { exportJson(state, localDateString); showToast("Your backup is ready to download."); }
  else if (action === "export-csv") exportCsv(state);
  else if (action === "import-json") document.querySelector("#backup-file").click();
  else if (action === "import-csv") openCsvImport(state, csvDialog);
  else if (action === "reset-data" && window.confirm("Delete all Paisa data from this browser? This cannot be undone. Export a backup first if you may need it.")) {
    await replaceAll(state.database, Object.fromEntries(storeNames.map((store) => [store, store === "categories" ? DEFAULT_CATEGORIES : store === "accounts" ? DEFAULT_ACCOUNTS : []])));
    state.settings = { theme: "light", currency: "INR", locale: "en-IN", schemaVersion: 1 };
    persistSettings();
    await reloadData(); render(); showToast("App data cleared.");
  } else if (action === "toggle-theme") toggleTheme();
  else if (action === "delete-category") await deleteCategory(state, target.dataset.id, categoryDialog, appServices);
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
  persistSettings(); render();
}

function handleFilter(event) {
  const field = event.target.dataset.filter;
  if (!field) return;
  if (field === "month") state.selectedMonth = event.target.value || monthKey(new Date());
  else if (field === "currency" || field === "locale") { state.settings[field] = event.target.value; persistSettings(); }
  else state.filters[field] = event.target.value;
  const isTyping = field === "query";
  const cursor = isTyping ? event.target.selectionStart : null;
  reloadData().then(() => {
    render();
    if (isTyping) {
      const search = root.querySelector('[data-filter="query"]');
      search?.focus(); search?.setSelectionRange(cursor, cursor);
    }
  }).catch((error) => { console.error("Could not update the current view.", error); showToast("Could not refresh the view."); });
}

function handleForm(event) {
  const form = event.target;
  if (form.id === "transaction-form") saveTransaction(event).catch((error) => { console.error("Could not save transaction.", error); showToast("Could not save transaction."); });
  else if (form.id === "csv-form") importCsv(event, state, { ...appServices, dialog: csvDialog }).catch((error) => { console.error("Could not import CSV.", error); showToast(error.message || "Could not import CSV."); });
  else if (form.id === "category-form") reassignCategory(event, state, categoryDialog, appServices).catch((error) => { console.error("Could not reassign category.", error); showToast("Could not reassign category."); });
  else if (form.dataset.form === "category") {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name || state.categories.some((item) => item.name.toLowerCase() === name.toLowerCase())) { showToast("Choose a category name that is not already in use."); return; }
    const icon = form.elements.icon.value.trim() || "✦";
    writeRecord(state.database, "categories", { id: crypto.randomUUID(), name, icon, color: PALETTE[state.categories.length % PALETTE.length], type: "both" })
      .then(async () => { await reloadData(); render(); showToast("Category added."); })
      .catch((error) => { console.error("Could not add category.", error); showToast("Could not add category."); });
  }
}

async function initialize() {
  state.database = await openDatabase();
  await seedStore(state.database, "categories", DEFAULT_CATEGORIES);
  await seedStore(state.database, "accounts", DEFAULT_ACCOUNTS);
  await keepMainBankAccount(state.database);
  await reloadData();
  await processRecurring(state, localDateString);
  await reloadData();
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(state.settings.locale, { weekday: "short", day: "numeric", month: "short" }).format(new Date());
  render();
  if (navigator.storage?.persist) await navigator.storage.persist();
  if ("serviceWorker" in navigator) {
    const isLocalHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
    if (isLocalHost) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) await registration.unregister();
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.filter((name) => name.startsWith("paisa-shell-")).map((name) => caches.delete(name)));
      } catch (error) {
        console.warn("Could not clear the local offline cache.", error);
      }
    } else if (location.protocol === "https:") {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Offline support could not be enabled.", error));
    }
  }
  if (!localStorage.getItem("paisa-backup-reminder")) {
    localStorage.setItem("paisa-backup-reminder", new Date().toISOString());
    showToast("A quick reminder: download a backup to keep your data safe.");
  } else {
    const lastReminder = new Date(localStorage.getItem("paisa-backup-reminder"));
    if (Date.now() - lastReminder.getTime() > 30 * 24 * 60 * 60 * 1000) {
      localStorage.setItem("paisa-backup-reminder", new Date().toISOString());
      showToast("It’s been a while — download a backup to keep your data safe.");
    }
  }
}

document.addEventListener("click", (event) => handleClick(event).catch((error) => { console.error("That action could not be completed.", error); showToast(error.message || "Something went wrong."); }));
document.addEventListener("input", handleFilter);
document.addEventListener("change", (event) => {
  if (event.target.id === "csv-file") {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => renderCsvMapping(state, parseCsv(text))).catch((error) => { console.error("Could not read CSV file.", error); showToast("Could not read that CSV file."); });
  } else if (event.target.dataset.filter) handleFilter(event);
});
document.addEventListener("submit", handleForm);
document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches('[role="button"][data-action="edit-transaction"]')) {
    event.preventDefault();
    openTransaction(event.target.dataset.id);
  }
});
document.querySelectorAll(".type-switch button").forEach((button) => button.addEventListener("click", () => {
  state.currentType = button.dataset.type;
  document.querySelectorAll(".type-switch button").forEach((item) => item.classList.toggle("is-selected", item === button));
  updateTransactionOptions();
}));
document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
document.querySelector("#backup-file").addEventListener("change", (event) => {
  const file = event.target.files?.[0]; event.target.value = "";
  if (file) restoreJson(file, state, appServices).catch((error) => { console.error("Could not restore backup.", error); showToast(error.message || "Could not restore backup."); });
});
document.querySelector("#transaction-amount").addEventListener("input", (event) => event.target.setCustomValidity(""));
initialize().catch((error) => {
  console.error("Paisa could not start.", error);
  const message = document.createElement("section"); message.className = "panel empty-state";
  const title = document.createElement("strong"); title.textContent = "Paisa couldn’t open its local storage.";
  const detail = document.createElement("span"); detail.textContent = "Try opening this app in a current browser with site storage enabled. Your data has not been changed.";
  message.append(title, detail); root.replaceChildren(message);
});
