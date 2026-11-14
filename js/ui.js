import { formatMoney, monthBounds, OVERALL_BUDGET_CATEGORY_ID } from "./utils.js";

export const element = (tag, className = "", text = "") => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== "") item.textContent = text;
  return item;
};
export const makeButton = (text, action, className = "text-button") => {
  const button = element("button", className, text);
  button.type = "button";
  button.dataset.action = action;
  return button;
};
export const heading = (title, subtitle, action) => {
  const wrapper = element("div", "page-heading");
  const copy = element("div");
  copy.append(element("p", "eyebrow", "YOUR FINANCES, IN FOCUS"), element("h1", "", title), element("p", "", subtitle));
  wrapper.append(copy);
  if (action) wrapper.append(action);
  return wrapper;
};
export const panelHeading = (title, subtitle = "") => {
  const wrapper = element("div", "panel-heading");
  const copy = element("div");
  copy.append(element("h2", "", title));
  if (subtitle) copy.append(element("p", "", subtitle));
  wrapper.append(copy);
  return wrapper;
};
export const selectControl = (label, options, value, datasetName) => {
  const select = element("select", "filter-control");
  select.setAttribute("aria-label", label);
  select.dataset.filter = datasetName;
  for (const [optionValue, text] of options) {
    const option = element("option", "", text);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  }
  return select;
};
export const currency = (state, amount) => formatMoney(amount, state.settings.currency, state.settings.locale);
export const dateLabel = (date, locale = "en-IN", options = { day: "numeric", month: "short" }) => new Intl.DateTimeFormat(locale, options).format(new Date(`${date}T12:00:00`));

export function transactionRow(transaction, state, actions = true) {
  const row = element("div", "transaction-row");
  const category = state.categories.find((item) => item.id === transaction.categoryId);
  const account = state.accounts.find((item) => item.id === transaction.accountId);
  const icon = element("span", "category-icon", category?.icon ?? "◌");
  icon.style.color = category?.color ?? "#8c9990";
  const description = element("div", "transaction-description");
  description.append(element("strong", "", transaction.note || category?.name || "Transaction"));
  description.append(element("small", "", `${category?.name ?? "Uncategorized"}${account ? ` · ${account.name}` : ""}`));
  const date = element("span", "transaction-date", dateLabel(transaction.date, state.settings.locale));
  const amount = element("strong", `transaction-amount ${transaction.type === "income" ? "income-text" : "expense-text"}`, `${transaction.type === "income" ? "+" : "−"}${currency(state, transaction.amountMinor)}`);
  row.append(icon, description, date, amount);
  if (actions) {
    row.tabIndex = 0;
    row.role = "button";
    row.setAttribute("aria-label", `${transaction.type} ${currency(state, transaction.amountMinor)} ${transaction.note || ""}, ${dateLabel(transaction.date, state.settings.locale)}. Edit transaction`);
    row.dataset.action = "edit-transaction";
    row.dataset.id = transaction.id;
  }
  return row;
}

export function renderTransactions(state, root) {
  const headingAction = element("div", "list-actions");
  headingAction.append(makeButton("Export CSV", "export-csv", "button button-quiet button-small"), makeButton("＋ Add transaction", "add-transaction", "button button-primary button-small"));
  root.append(heading("Transactions", "Select any income or expense transaction to edit or delete it.", headingAction));
  const filterPanel = element("section", "panel filter-panel");
  const search = element("input", "filter-control search-control");
  search.type = "search"; search.placeholder = "Search notes, category or account"; search.value = state.filters.query;
  search.dataset.filter = "query"; search.setAttribute("aria-label", "Search transactions");
  filterPanel.append(search);
  filterPanel.append(selectControl("Filter by category", [["", "All categories"], ...state.categories.map((item) => [item.id, item.name])], state.filters.categoryId, "categoryId"));
  filterPanel.append(selectControl("Filter by account", [["", "All accounts"], ...state.accounts.map((item) => [item.id, item.name])], state.filters.accountId, "accountId"));
  for (const [name, label] of [["dateFrom", "From date"], ["dateTo", "To date"]]) {
    const input = element("input", "filter-control date-control"); input.type = "date"; input.value = state.filters[name];
    input.dataset.filter = name; input.setAttribute("aria-label", label); filterPanel.append(input);
  }
  root.append(filterPanel);
  root.append(element("p", "list-meta", `${state.filteredTransactions.length} transaction${state.filteredTransactions.length === 1 ? "" : "s"} found`));
  const panel = element("section", "panel");
  const list = element("div", "transaction-list");
  const visible = state.filteredTransactions.slice(0, state.listLimit);
  if (visible.length) visible.forEach((item) => list.append(transactionRow(item, state)));
  else {
    const empty = element("div", "empty-state");
    empty.append(element("strong", "", state.transactions.length ? "No matches this time" : "Your story starts here"), element("span", "", state.transactions.length ? "Try broadening your filters." : "Add a transaction and your activity will live here."));
    list.append(empty);
  }
  panel.append(list);
  if (state.filteredTransactions.length > visible.length) panel.append(makeButton("Show more", "show-more", "button button-quiet button-small"));
  root.append(panel);
}

export function renderBudgets(state, root) {
  const actions = element("div", "list-actions");
  actions.append(
    makeButton("Set overall budget", "set-overall-budget", "button button-quiet button-small"),
    makeButton("＋ Add category budget", "add-budget", "button button-primary button-small"),
  );
  root.append(heading("Budgets", "Plan with intention. Adjust whenever life changes.", actions));
  const monthInput = element("input", "month-select"); monthInput.type = "month"; monthInput.value = state.selectedMonth;
  monthInput.dataset.filter = "month"; monthInput.setAttribute("aria-label", "Select budget month");
  const intro = element("div", "section-heading"); intro.append(element("h2", "", "Monthly category limits"), monthInput); root.append(intro);
  const { start, end } = monthBounds(state.selectedMonth);
  const overallBudget = state.budgets.find((item) => item.categoryId === OVERALL_BUDGET_CATEGORY_ID && item.month === state.selectedMonth);
  const categoryBudgetTotal = state.budgets
    .filter((item) => item.month === state.selectedMonth && item.categoryId !== OVERALL_BUDGET_CATEGORY_ID)
    .reduce((total, item) => total + item.limitMinor, 0);
  const totalSpent = state.transactions
    .filter((item) => item.type === "expense" && item.date >= start && item.date <= end)
    .reduce((total, item) => total + item.amountMinor, 0);
  const overallCard = element("section", "panel overall-budget-card");
  const overallHeading = element("div", "section-heading");
  overallHeading.append(
    element("h2", "", "Overall monthly budget"),
    makeButton(overallBudget ? "Edit" : "Set", "set-overall-budget", "text-button"),
  );
  overallCard.append(overallHeading);
  if (overallBudget) {
    const percent = totalSpent / overallBudget.limitMinor * 100;
    overallCard.append(element("strong", "overall-budget-amount", `${currency(state, totalSpent)} spent of ${currency(state, overallBudget.limitMinor)}`));
    const track = element("div", "progress-track");
    const fill = element("div", `progress-fill${percent >= 100 ? " over" : percent >= 80 ? " warning" : ""}`);
    fill.style.width = `${Math.min(100, percent)}%`;
    fill.setAttribute("role", "progressbar");
    fill.setAttribute("aria-valuenow", String(Math.round(percent)));
    fill.setAttribute("aria-valuemin", "0");
    fill.setAttribute("aria-valuemax", "100");
    fill.setAttribute("aria-label", "Overall budget used");
    track.append(fill);
    overallCard.append(track);
  } else {
    overallCard.append(element("p", "muted", "No overall limit set for this month."));
  }
  overallCard.append(element("p", "settings-note", `${currency(state, categoryBudgetTotal)} allocated across category budgets.`));
  root.append(overallCard);
  const spent = new Map();
  for (const item of state.transactions) if (item.type === "expense" && item.date >= start && item.date <= end) {
    spent.set(item.categoryId, (spent.get(item.categoryId) ?? 0) + item.amountMinor);
  }
  const expenseCategories = state.categories.filter((item) => item.type !== "income");
  const list = element("div", "budget-list");
  for (const category of expenseCategories) {
    const budget = state.budgets.find((item) => item.categoryId === category.id && item.month === state.selectedMonth);
    if (!budget) continue;
    const amount = spent.get(category.id) ?? 0;
    const percent = Math.min(100, amount / budget.limitMinor * 100);
    const card = element("article", "budget-card");
    const line = element("div", "budget-title-line");
    const icon = element("span", "category-icon", category.icon); icon.style.color = category.color;
    line.append(icon);
    const copy = element("span"); copy.append(element("strong", "", category.name), element("small", "", `${Math.round(percent)}% used`));
    line.append(copy, element("span", "budget-amount", `${currency(state, amount)} / ${currency(state, budget.limitMinor)}`));
    const track = element("div", "progress-track");
    const fill = element("div", `progress-fill${percent >= 100 ? " over" : percent >= 80 ? " warning" : ""}`);
    fill.style.width = `${percent}%`; fill.setAttribute("role", "progressbar"); fill.setAttribute("aria-valuenow", String(Math.round(percent)));
    fill.setAttribute("aria-valuemin", "0"); fill.setAttribute("aria-valuemax", "100"); fill.setAttribute("aria-label", `${category.name} budget used`);
    track.append(fill);
    const remaining = budget.limitMinor - amount;
    const foot = element("div", "budget-foot");
    foot.append(element("span", `budget-remaining${remaining < 0 ? " over" : ""}`, remaining < 0 ? `${currency(state, -remaining)} over budget` : `${currency(state, remaining)} remaining`));
    foot.append(makeButton("Edit", "edit-budget", "text-button"));
    foot.lastChild.dataset.categoryId = category.id;
    card.append(line, track, foot);
    list.append(card);
  }
  if (!list.children.length) {
    const empty = element("section", "panel empty-state");
    empty.append(element("strong", "", "Give your spending a gentle guardrail"), element("span", "", "Set a monthly limit for the categories that matter to you."));
    list.append(empty);
  }
  root.append(list);
}

export function renderPlanning(state, root) {
  const actions = element("div", "list-actions");
  actions.append(makeButton("＋ Add goal", "add-goal", "button button-primary button-small"), makeButton("＋ Add recurring", "add-recurring", "button button-quiet button-small"));
  root.append(heading("Goals & bills", "Make room for what matters — and stay ahead of what’s due.", actions));
  const title = element("div", "section-heading with-intro"); title.append(element("h2", "", "Savings goals")); root.append(title);
  const goals = element("div", "settings-grid");
  for (const goal of state.goals) {
    const card = element("article", "goal-card");
    const top = element("div", "goal-top");
    top.append(element("span", "goal-mark", "✦"));
    const copy = element("div"); copy.append(element("h3", "", goal.name), element("p", "", goal.targetDate ? `Target · ${dateLabel(goal.targetDate, state.settings.locale, { day: "numeric", month: "short", year: "numeric" })}` : "Your next big thing"));
    const goalActions = element("div", "goal-actions");
    const contribute = makeButton("＋", "contribute-goal", "icon-button"); contribute.setAttribute("aria-label", `Add to ${goal.name}`); contribute.dataset.id = goal.id;
    const remove = makeButton("×", "delete-goal", "icon-button"); remove.setAttribute("aria-label", `Delete ${goal.name}`); remove.dataset.id = goal.id;
    goalActions.append(contribute, remove); top.append(copy, goalActions);
    const percent = Math.min(100, goal.savedMinor / goal.targetMinor * 100);
    const track = element("div", "progress-track"); const fill = element("div", "progress-fill");
    fill.style.width = `${percent}%`; fill.setAttribute("role", "progressbar"); fill.setAttribute("aria-valuenow", String(Math.round(percent))); fill.setAttribute("aria-valuemin", "0"); fill.setAttribute("aria-valuemax", "100");
    track.append(fill);
    const stats = element("div", "goal-stats"); stats.append(element("strong", "", currency(state, goal.savedMinor)), element("span", "", `${Math.round(percent)}% · ${currency(state, goal.targetMinor)} target`));
    card.append(top, track, stats); goals.append(card);
  }
  if (!goals.children.length) goals.append(element("section", "panel empty-state", "Your savings goals will appear here."));
  root.append(goals);
  const recurringHeading = element("div", "section-heading with-intro"); recurringHeading.append(element("h2", "", "Recurring bills & income")); root.append(recurringHeading);
  const recurringList = element("section", "panel transaction-list");
  for (const rule of state.recurring) {
    const item = element("div", "transaction-row");
    const category = state.categories.find((cat) => cat.id === rule.categoryId);
    item.append(element("span", "category-icon", category?.icon ?? "↻"));
    const copy = element("div", "transaction-description");
    copy.append(element("strong", "", rule.note || category?.name || "Recurring transaction"));
    copy.append(element("small", "", `${rule.frequency} · next ${dateLabel(rule.nextDue, state.settings.locale)}`));
    const amount = element("strong", "transaction-amount", `${rule.type === "income" ? "+" : "−"}${currency(state, rule.amountMinor)}`);
    const remove = makeButton("×", "delete-recurring", "icon-button"); remove.setAttribute("aria-label", "Delete recurring rule"); remove.dataset.id = rule.id;
    item.append(copy, amount, remove); recurringList.append(item);
  }
  if (!state.recurring.length) recurringList.append(element("div", "empty-state", "No recurring transactions yet."));
  root.append(recurringList);
}

function settingsCard(title, subtitle) {
  const card = element("section", "settings-card");
  card.append(element("h2", "", title), element("p", "", subtitle));
  return card;
}

export function renderSettings(state, root) {
  root.append(heading("Settings", "Your preferences and your data, always in your hands."));
  const grid = element("div", "settings-grid");
  const preferences = settingsCard("Preferences", "Set up Paisa to feel like yours.");
  const currencyRow = element("div", "settings-row");
  const currencyCopy = element("span"); currencyCopy.append(element("strong", "", "Display currency"), element("small", "", "Choose how amounts are shown"));
  const currencySelect = selectControl("Display currency", [["INR", "INR · ₹"], ["USD", "USD · $"], ["EUR", "EUR · €"], ["GBP", "GBP · £"], ["SGD", "SGD · $"], ["AUD", "AUD · $"]], state.settings.currency, "currency");
  currencyRow.append(currencyCopy, currencySelect); preferences.append(currencyRow);
  const localeRow = element("div", "settings-row"); const localeCopy = element("span");
  localeCopy.append(element("strong", "", "Number & date format"), element("small", "", "Regional display format"));
  const localeSelect = selectControl("Number and date format", [["en-IN", "India · 1,00,000"], ["en-US", "United States · 100,000"], ["en-GB", "United Kingdom · 100,000"]], state.settings.locale, "locale");
  localeRow.append(localeCopy, localeSelect); preferences.append(localeRow);
  const themeRow = element("div", "settings-row"); const themeCopy = element("span");
  themeCopy.append(element("strong", "", "Colour theme"), element("small", "", "Choose a comfortable look"));
  const themeButton = makeButton(state.settings.theme === "dark" ? "Dark" : "Light", "toggle-theme", "button button-quiet button-small");
  themeRow.append(themeCopy, themeButton); preferences.append(themeRow);

  const categoryCard = settingsCard("Categories", "Add categories that match your everyday.");
  for (const category of state.categories) {
    const row = element("div", "settings-row");
    const icon = element("span", "category-icon", category.icon); icon.style.color = category.color;
    const copy = element("span"); copy.append(element("strong", "", category.name), element("small", "", category.type === "both" ? "Income & expense" : category.type));
    const remove = makeButton("×", "delete-category", "icon-button"); remove.dataset.id = category.id; remove.setAttribute("aria-label", `Delete ${category.name}`);
    row.append(icon, copy, remove); categoryCard.append(row);
  }
  const categoryForm = element("form", "settings-form-row"); categoryForm.dataset.form = "category";
  const categoryName = element("input"); categoryName.name = "name"; categoryName.placeholder = "New category"; categoryName.maxLength = 32; categoryName.required = true; categoryName.setAttribute("aria-label", "New category name");
  const categoryIcon = element("input"); categoryIcon.name = "icon"; categoryIcon.value = "✦"; categoryIcon.maxLength = 2; categoryIcon.setAttribute("aria-label", "Category icon");
  const categoryAdd = element("button", "button button-primary button-small", "Add"); categoryAdd.type = "submit";
  categoryForm.append(categoryName, categoryIcon, categoryAdd); categoryCard.append(categoryForm);

  const accountCard = settingsCard("Account", "All transactions use Main Bank.");
  const accountList = element("div", "account-list");
  for (const account of state.accounts) {
    const row = element("div", "account-row");
    row.append(element("span", "category-icon", "▤"));
    row.append(element("strong", "", account.name), element("small", "", currency(state, accountBalance(state, account))));
    accountList.append(row);
  }
  accountCard.append(accountList);

  const backupCard = settingsCard("Backup & restore", "Your data never leaves this device unless you export it.");
  backupCard.append(makeButton("Download full JSON backup", "export-json", "button button-primary button-small"));
  const restore = makeButton("Restore from JSON", "import-json", "button button-quiet button-small"); restore.style.marginLeft = "7px";
  backupCard.append(restore, makeButton("Import a bank CSV", "import-csv", "button button-quiet button-small"));
  const note = element("p", "settings-note", "Paisa stores transactions in this browser on this device. Clearing browser data will erase them. Keep a backup somewhere safe.");
  note.style.marginTop = "15px"; backupCard.append(note);

  const dataCard = settingsCard("Your privacy", "No account, trackers, bank connection, or server.");
  dataCard.append(element("p", "settings-note", "All records stay in your browser’s IndexedDB. Export a backup before moving to another browser or device."));
  dataCard.append(makeButton("Delete all app data", "reset-data", "button button-quiet button-small"));
  grid.append(preferences, categoryCard, accountCard, backupCard, dataCard);
  root.append(grid);
}

function accountBalance(state, account) {
  return state.transactions.reduce((balance, item) => {
    if (item.accountId !== account.id) return balance;
    return balance + (item.type === "income" ? item.amountMinor : -item.amountMinor);
  }, account.openingBalanceMinor);
}
