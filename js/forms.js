import { amountToMinor, closeDialog, openDialog } from "./utils.js";

function createDialog(title, fields, onSubmit, services, submitLabel = "Save") {
  const dialog = document.createElement("dialog"); dialog.className = "modal modal-small";
  const form = document.createElement("form"); form.className = "modal-form";
  const header = document.createElement("div"); header.className = "modal-header";
  const titleWrap = document.createElement("div");
  const eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = "A LITTLE STEP TOWARD YOUR PLAN";
  const h2 = document.createElement("h2"); h2.textContent = title;
  titleWrap.append(eyebrow, h2);
  const close = document.createElement("button"); close.type = "button"; close.className = "icon-button"; close.textContent = "×"; close.setAttribute("aria-label", "Close"); close.addEventListener("click", () => closeDialog(dialog));
  header.append(titleWrap, close); form.append(header);
  for (const field of fields) {
    const label = document.createElement("label"); label.className = "field-label"; label.textContent = field.label; label.htmlFor = `dialog-${field.name}`;
    const input = document.createElement(field.options ? "select" : "input");
    input.id = `dialog-${field.name}`; input.name = field.name; input.required = field.required ?? true;
    if (field.type) input.type = field.type;
    if (field.min !== undefined) input.min = field.min;
    if (field.step) input.step = field.step;
    if (field.maxLength) input.maxLength = field.maxLength;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.options) for (const [value, text] of field.options) { const option = document.createElement("option"); option.value = value; option.textContent = text; input.append(option); }
    if (field.value !== undefined) input.value = field.value;
    form.append(label, input);
  }
  const actions = document.createElement("div"); actions.className = "modal-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "button button-quiet"; cancel.textContent = "Cancel"; cancel.addEventListener("click", () => closeDialog(dialog));
  const submit = document.createElement("button"); submit.type = "submit"; submit.className = "button button-primary"; submit.textContent = submitLabel;
  actions.append(cancel, submit); form.append(actions); dialog.append(form); document.body.append(dialog);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await onSubmit(new FormData(form)); closeDialog(dialog); dialog.remove(); await services.reloadData(); services.render(); }
    catch (error) { console.error("Could not save this item.", error); services.showToast(error.message || "Could not save. Please try again."); }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  openDialog(dialog);
  return dialog;
}

export function createBudgetDialog(state, categoryId, services) {
  const categories = state.categories.filter((item) => item.type !== "income");
  const month = state.selectedMonth;
  const existing = state.budgets.find((item) => item.categoryId === categoryId && item.month === month);
  createDialog(categoryId ? "Adjust budget" : "Set a monthly budget", [
    { name: "categoryId", label: "Category", options: categories.map((item) => [item.id, `${item.icon}  ${item.name}`]), value: categoryId || categories[0]?.id },
    { name: "amount", label: "Monthly limit", type: "number", min: "0.01", step: "0.01", placeholder: "0.00", value: existing ? (existing.limitMinor / 100).toFixed(2) : "" },
  ], async (data) => {
    const limitMinor = amountToMinor(data.get("amount"));
    if (!limitMinor) throw new Error("Enter a valid budget greater than zero.");
    const id = `${data.get("categoryId")}-${month}`;
    await services.writeRecord(state.database, "budgets", { id, categoryId: data.get("categoryId"), month, limitMinor, updatedAt: new Date().toISOString() });
  }, services);
}

export function createGoalDialog(state, services) {
  createDialog("A goal worth saving for", [
    { name: "name", label: "Goal name", placeholder: "A rainy day fund", maxLength: 48 },
    { name: "target", label: "Target amount", type: "number", min: "0.01", step: "0.01", placeholder: "0.00" },
    { name: "targetDate", label: "Target date (optional)", type: "date", required: false },
  ], async (data) => {
    const targetMinor = amountToMinor(data.get("target"));
    if (!targetMinor) throw new Error("Enter a valid target amount.");
    await services.writeRecord(state.database, "goals", { id: crypto.randomUUID(), name: data.get("name").trim(), targetMinor, targetDate: data.get("targetDate"), savedMinor: 0 });
  }, services);
}

export function createRecurringDialog(state, services) {
  createDialog("Set a recurring transaction", [
    { name: "type", label: "Type", options: [["expense", "Expense"], ["income", "Income"]] },
    { name: "amount", label: "Amount", type: "number", min: "0.01", step: "0.01", placeholder: "0.00" },
    { name: "categoryId", label: "Category", options: state.categories.map((item) => [item.id, `${item.icon}  ${item.name}`]) },
    { name: "frequency", label: "Repeat", options: [["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]] },
    { name: "nextDue", label: "Next date", type: "date", value: services.localDateString() },
    { name: "note", label: "Note", required: false, maxLength: 120, placeholder: "Rent, subscription…" },
  ], async (data) => {
    const amountMinor = amountToMinor(data.get("amount"));
    if (!amountMinor) throw new Error("Enter a valid amount.");
    const nextDue = String(data.get("nextDue"));
    const type = String(data.get("type"));
    const category = state.categories.find((item) => item.id === data.get("categoryId"));
    if (!category || (category.type !== type && category.type !== "both")) throw new Error("Choose a category for this transaction type.");
    await services.writeRecord(state.database, "recurring", {
      id: crypto.randomUUID(), type, amountMinor, categoryId: category.id,
      accountId: state.accounts[0]?.id ?? "", frequency: data.get("frequency"), nextDue,
      dayOfMonth: Number(nextDue.slice(8, 10)), note: String(data.get("note")).trim(), createdAt: new Date().toISOString(),
    });
  }, services);
}

export function createContributionDialog(state, goalId, services) {
  createDialog("Add to your goal", [{ name: "amount", label: "Contribution amount", type: "number", min: "0.01", step: "0.01", placeholder: "0.00" }], async (data) => {
    const amountMinor = amountToMinor(data.get("amount"));
    if (!amountMinor) throw new Error("Enter a valid contribution.");
    const goal = state.goals.find((item) => item.id === goalId);
    if (!goal) throw new Error("This goal no longer exists.");
    await services.writeRecord(state.database, "goals", { ...goal, savedMinor: goal.savedMinor + amountMinor });
  }, services, "Add contribution");
}
