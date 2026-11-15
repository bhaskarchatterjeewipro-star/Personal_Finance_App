import { deleteRecord, readAll, writeRecord } from "./db.js";
import { closeDialog, openDialog } from "./utils.js";

export async function deleteCategory(state, id, dialog, services) {
  const category = state.categories.find((item) => item.id === id);
  if (!category) return;
  const used = ["transactions", "budgets", "recurring"].some((store) => state[store].some((item) => item.categoryId === id));
  if (!used) {
    if (!window.confirm(`Delete “${category.name}”?`)) return;
    await deleteRecord(state.database, "categories", id);
    await services.reloadData(); services.render(); services.showToast("Category deleted.");
    return;
  }
  const alternatives = state.categories.filter((item) => item.id !== id && (item.type === category.type || item.type === "both" || category.type === "both"));
  if (!alternatives.length) { services.showToast("Add another matching category before deleting this one."); return; }
  state.pendingCategoryId = id;
  const select = document.querySelector("#category-reassign"); select.replaceChildren();
  for (const item of alternatives) { const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.icon}  ${item.name}`; select.append(option); }
  document.querySelector("#category-delete-copy").textContent = `“${category.name}” is in use. Reassign its transactions, budgets, and recurring rules before removing it.`;
  openDialog(dialog);
}

export async function reassignCategory(event, state, dialog, services) {
  event.preventDefault();
  const from = state.pendingCategoryId; const to = document.querySelector("#category-reassign").value;
  if (!from || !to) return;
  for (const store of ["transactions", "budgets", "recurring"]) {
    const records = await readAll(state.database, store);
    for (const item of records) {
      if (item.categoryId === from) await writeRecord(state.database, store, { ...item, categoryId: to });
    }
  }
  await deleteRecord(state.database, "categories", from);
  closeDialog(dialog); state.pendingCategoryId = null; await services.reloadData(); services.render(); services.showToast("Category reassigned.");
}
