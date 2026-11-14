import { replaceAll, storeNames } from "./db.js";
import { amountToMinor, backupCollectionsValid, closeDialog, openDialog, parseCsv } from "./utils.js";

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export function exportJson(state, localDateString) {
  const collections = Object.fromEntries(storeNames.map((store) => [store, state[store]]));
  downloadFile(`paisa-backup-${localDateString()}.json`, JSON.stringify({ app: "paisa", schemaVersion: 1, exportedAt: new Date().toISOString(), settings: state.settings, collections }, null, 2), "application/json");
}

export function exportCsv(state) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [["date", "type", "amount", "category", "account", "note"]];
  for (const item of state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([item.date, item.type, (item.amountMinor / 100).toFixed(2),
      state.categories.find((cat) => cat.id === item.categoryId)?.name ?? "",
      state.accounts.find((account) => account.id === item.accountId)?.name ?? "", item.note]);
  }
  downloadFile("paisa-transactions.csv", rows.map((row) => row.map(quote).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}

export async function restoreJson(file, state, services) {
  const data = JSON.parse(await file.text());
  if (!backupCollectionsValid(data)) throw new Error("This file is not a valid Paisa backup.");
  if (!window.confirm("Restore this backup? It will replace the data currently stored in this browser.")) return;
  await replaceAll(state.database, data.collections);
  if (data.settings && ["light", "dark"].includes(data.settings.theme)
    && ["INR", "USD", "EUR", "GBP", "SGD", "AUD"].includes(data.settings.currency)
    && ["en-IN", "en-US", "en-GB"].includes(data.settings.locale)) {
    state.settings = { ...state.settings, ...data.settings };
    services.persistSettings();
  }
  await services.reloadData(); services.render(); services.showToast("Backup restored successfully.");
}

export function openCsvImport(state, dialog) {
  document.querySelector("#csv-form").reset();
  document.querySelector("#csv-mapping").replaceChildren();
  document.querySelector("#csv-mapping").hidden = true;
  document.querySelector("#csv-preview").textContent = "";
  document.querySelector("#csv-import-button").disabled = true;
  state.csvData = null; openDialog(dialog);
}

export function renderCsvMapping(state, data) {
  state.csvData = data;
  const box = document.querySelector("#csv-mapping"); box.replaceChildren(); box.hidden = false;
  const guess = (hints) => data.headers.find((header) => hints.some((hint) => header.toLowerCase().includes(hint))) ?? "";
  const mappings = [["date", "Date", ["date", "posted"]], ["amount", "Amount", ["amount", "value", "total"]], ["note", "Description", ["description", "merchant", "note", "payee"]], ["type", "Type (optional)", ["type", "direction"]], ["category", "Category (optional)", ["category"]]];
  for (const [key, label, hints] of mappings) {
    const wrap = document.createElement("div"); const labelEl = document.createElement("label");
    labelEl.className = "field-label"; labelEl.textContent = label;
    const select = document.createElement("select"); select.dataset.csvField = key; select.required = key === "date" || key === "amount";
    const optional = document.createElement("option"); optional.value = ""; optional.textContent = "— Skip —"; select.append(optional);
    for (const header of data.headers) { const option = document.createElement("option"); option.value = header; option.textContent = header; option.selected = header === guess(hints); select.append(option); }
    labelEl.htmlFor = `csv-${key}`; select.id = `csv-${key}`; wrap.append(labelEl, select); box.append(wrap);
  }
  const preview = document.querySelector("#csv-preview");
  preview.textContent = `${data.rows.length} row${data.rows.length === 1 ? "" : "s"} found. Preview: ${data.rows.slice(0, 3).map((row) => Object.values(row).slice(0, 3).join(" · ")).join(" / ")}`;
  document.querySelector("#csv-import-button").disabled = data.rows.length === 0;
}

function normalizeCsvDate(value, locale) {
  const clean = value.trim();
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? clean : "";
  }
  const match = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return "";
  const [, first, second, yearText] = match;
  const year = Number(yearText) < 100 ? 2000 + Number(yearText) : Number(yearText);
  let month; let day;
  if (Number(first) > 12) [month, day] = [Number(second), Number(first)];
  else if (Number(second) > 12) [month, day] = [Number(first), Number(second)];
  else if (locale === "en-US") [month, day] = [Number(first), Number(second)];
  else [month, day] = [Number(second), Number(first)];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
}

export async function importCsv(event, state, services) {
  event.preventDefault();
  if (!state.csvData) return;
  const mapping = Object.fromEntries([...document.querySelectorAll("[data-csv-field]")].map((select) => [select.dataset.csvField, select.value]));
  if (!mapping.date || !mapping.amount) { services.showToast("Choose both a date and amount column."); return; }
  let imported = 0; let skipped = 0; const now = new Date().toISOString();
  const seen = new Set(state.transactions.map((item) => `${item.date}|${item.amountMinor}|${item.note}`));
  for (const row of state.csvData.rows) {
    const date = normalizeCsvDate(row[mapping.date] ?? "", state.settings.locale);
    const rawAmountText = String(row[mapping.amount] ?? "").trim();
    const absoluteAmount = amountToMinor(rawAmountText);
    if (!date || !absoluteAmount) { skipped += 1; continue; }
    const direction = mapping.type ? (row[mapping.type] ?? "").toLowerCase() : "";
    const isNegativeAmount = rawAmountText.startsWith("(") || rawAmountText.startsWith("-") || rawAmountText.includes(")") || rawAmountText.includes("-");
    const isIncomeAmount = direction.includes("income") || direction === "credit" || direction === "cr" || rawAmountText.startsWith("+");
    const type = isNegativeAmount ? "expense" : isIncomeAmount ? "income" : "expense";
    const note = mapping.note ? row[mapping.note] ?? "" : "";
    const duplicateKey = `${date}|${absoluteAmount}|${note}`;
    if (seen.has(duplicateKey)) { skipped += 1; continue; }
    const categoryName = mapping.category ? (row[mapping.category] ?? "").toLowerCase() : "";
    const category = state.categories.find((item) => item.name.toLowerCase() === categoryName && (item.type === type || item.type === "both"))
      ?? state.categories.find((item) => item.id === "other");
    await services.writeRecord(state.database, "transactions", {
      id: crypto.randomUUID(), type, amountMinor: absoluteAmount, date, categoryId: category?.id ?? state.categories[0]?.id ?? "",
      accountId: state.accounts[0]?.id ?? "", note: note.slice(0, 120), createdAt: now, updatedAt: now,
    });
    seen.add(duplicateKey); imported += 1;
  }
  closeDialog(services.dialog); await services.reloadData(); services.render();
  services.showToast(`${imported} imported · ${skipped} skipped`);
}
