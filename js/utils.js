export const DEFAULT_CATEGORIES = [
  { id: "food", name: "Food & dining", icon: "🍲", color: "#739d70", type: "expense" },
  { id: "transport", name: "Transport", icon: "🚕", color: "#dfaa61", type: "expense" },
  { id: "home", name: "Home & bills", icon: "⌂", color: "#8096b4", type: "expense" },
  { id: "shopping", name: "Shopping", icon: "✳", color: "#c78073", type: "expense" },
  { id: "health", name: "Health", icon: "✚", color: "#8b83b6", type: "expense" },
  { id: "fun", name: "Fun", icon: "☼", color: "#d18c56", type: "expense" },
  { id: "salary", name: "Salary", icon: "↗", color: "#4b8a67", type: "income" },
  { id: "fund-transfer", name: "Fund Transfers", icon: "⇄", color: "#5e7ad8", type: "both" },
  { id: "other", name: "Other", icon: "◌", color: "#8c9990", type: "both" },
];

export const DEFAULT_ACCOUNTS = [
  { id: "bank", name: "Main Bank", kind: "bank", openingBalanceMinor: 0 },
];

export const OVERALL_BUDGET_CATEGORY_ID = "__overall__";
export const PALETTE = ["#739d70", "#dfaa61", "#8096b4", "#c78073", "#8b83b6", "#d18c56", "#4b8a67", "#8c9990"];

export function amountToMinor(value) {
  if (value === null || value === undefined) return null;
  let cleaned = String(value).trim();
  if (!cleaned) return null;
  cleaned = cleaned.replace(/[\s\u00A0]/g, "");
  cleaned = cleaned.replace(/[₹$£€]/g, "");
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) cleaned = cleaned.slice(1, -1);
  cleaned = cleaned.replace(/[+]/g, "");
  cleaned = cleaned.replace(/^[-]/, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    if (parts.length > 1 && parts[parts.length - 1].length === 3) cleaned = parts.join("");
    else cleaned = cleaned.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function formatMoney(minor, currency = "INR", locale = "en-IN") {
  return new Intl.NumberFormat(locale || "en-IN", {
    style: "currency", currency: currency || "INR", maximumFractionDigits: 2,
  }).format((Number(minor) || 0) / 100);
}

export function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    return;
  }
  dialog.setAttribute("open", "open");
  dialog.hidden = false;
  dialog.style.display = "block";
}

export function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
  dialog.hidden = true;
  dialog.style.display = "none";
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function dateFromMonth(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function monthBounds(key) {
  const start = dateFromMonth(key);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  return { start: `${key}-01`, end: `${key}-${String(lastDay).padStart(2, "0")}` };
}

export function getMonthTotals(transactions, month) {
  const { start, end } = monthBounds(month);
  return transactions.reduce((totals, transaction) => {
    if (transaction.date < start || transaction.date > end) return totals;
    totals[transaction.type] += transaction.amountMinor;
    return totals;
  }, { income: 0, expense: 0 });
}

export function filterTransactions(transactions, filters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return transactions.filter((item) => {
    const text = `${item.note} ${filters.categoryNames[item.categoryId] ?? ""} ${filters.accountNames[item.accountId] ?? ""}`.toLocaleLowerCase();
    return (!query || text.includes(query))
      && (!filters.categoryId || item.categoryId === filters.categoryId)
      && (!filters.accountId || item.accountId === filters.accountId)
      && (!filters.dateFrom || item.date >= filters.dateFrom)
      && (!filters.dateTo || item.date <= filters.dateTo);
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ""));
  return { headers, rows: rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))) };
}
