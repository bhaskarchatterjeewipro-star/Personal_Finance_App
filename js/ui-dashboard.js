import { monthBounds, monthKey } from "./utils.js";
import { currency, element, heading, panelHeading, makeButton, transactionRow } from "./ui.js";

function summaryCard(label, value, hint, icon, isSavings = false) {
  const card = element("article", `summary-card${isSavings ? " savings-card" : ""}`);
  const top = element("div", "summary-top");
  top.append(element("span", "", label), element("span", "summary-icon", icon));
  card.append(top, element("div", "summary-value", value), element("div", "summary-caption", hint));
  return card;
}

function donutPanel(state, expenses) {
  const panel = element("section", "panel");
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  panel.append(panelHeading("Spending by category", total ? `${currency(state, total)} across your categories` : "Your spending will show up here"));
  const layout = element("div", "donut-layout");
  if (!total) {
    layout.append(element("div", "empty-state", "Add an expense to see your spending breakdown."));
    panel.append(layout);
    return panel;
  }
  const wrap = element("div", "donut-wrap");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 42 42");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "21"); circle.setAttribute("cy", "21"); circle.setAttribute("r", "15.9");
  circle.setAttribute("fill", "none"); circle.setAttribute("stroke", "#edf0ec"); circle.setAttribute("stroke-width", "5.5");
  svg.append(circle);
  let offset = 25;
  for (const slice of expenses) {
    const segment = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const length = (slice.amount / total) * 100;
    segment.setAttribute("cx", "21"); segment.setAttribute("cy", "21"); segment.setAttribute("r", "15.9");
    segment.setAttribute("fill", "none"); segment.setAttribute("stroke", slice.category.color);
    segment.setAttribute("stroke-width", "5.5"); segment.setAttribute("stroke-dasharray", `${length} ${100 - length}`);
    segment.setAttribute("stroke-dashoffset", String(offset)); segment.setAttribute("aria-label", `${slice.category.name}: ${currency(state, slice.amount)}`);
    svg.append(segment);
    offset -= length;
  }
  const center = element("div", "donut-center");
  center.append(element("strong", "", currency(state, total)), element("small", "", "total spent"));
  wrap.append(svg, center);
  const legend = element("div", "category-legend");
  for (const slice of expenses.slice(0, 5)) {
    const line = element("div", "category-line");
    const swatch = element("i"); swatch.style.backgroundColor = slice.category.color;
    line.append(swatch, element("span", "", slice.category.name), element("strong", "", currency(state, slice.amount)));
    legend.append(line);
  }
  layout.append(wrap, legend);
  panel.append(layout);
  return panel;
}

function trendPanel(state) {
  const panel = element("section", "panel");
  panel.append(panelHeading("Your six-month rhythm", "Income and spending, month by month"));
  const months = [];
  const current = new Date(`${state.selectedMonth}-01T12:00:00`);
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(current.getFullYear(), current.getMonth() - offset, 1);
    const key = monthKey(date);
    const { start, end } = monthBounds(key);
    const totals = state.transactions.filter((item) => item.date >= start && item.date <= end)
      .reduce((acc, item) => { acc[item.type] += item.amountMinor; return acc; }, { income: 0, expense: 0 });
    months.push({ label: new Intl.DateTimeFormat(state.settings.locale, { month: "short" }).format(date), ...totals });
  }
  const max = Math.max(1, ...months.flatMap((item) => [item.income, item.expense]));
  const chart = element("div", "trend-chart");
  for (const month of months) {
    const column = element("div", "trend-month");
    const area = element("div", "trend-bar-area");
    for (const [type, value] of [["expense", month.expense], ["income", month.income]]) {
      const bar = element("div", `trend-bar${type === "income" ? " income" : ""}`);
      bar.style.height = `${value ? Math.max(3, value / max * 100) : 1}%`;
      bar.title = `${month.label} ${type}: ${currency(state, value)}`;
      bar.setAttribute("aria-label", bar.title);
      area.append(bar);
    }
    column.append(area, element("small", "", month.label));
    chart.append(column);
  }
  panel.append(chart);
  const legend = element("div", "legend");
  legend.append(element("span", "", "Spending"), element("span", "", "Income"));
  legend.children[0].prepend(element("i"));
  const incomeDot = element("i", "income-dot"); legend.children[1].prepend(incomeDot);
  panel.append(legend);
  return panel;
}

export function renderDashboard(state, root) {
  const monthDate = new Date(`${state.selectedMonth}-01T12:00:00`);
  const monthTitle = new Intl.DateTimeFormat(state.settings.locale, { month: "long", year: "numeric" }).format(monthDate);
  const picker = element("input", "month-select");
  picker.type = "month"; picker.value = state.selectedMonth; picker.dataset.filter = "month"; picker.setAttribute("aria-label", "Select dashboard month");
  root.append(heading("Good to see you", "Here's how your money is doing this month.", picker));
  const totals = state.monthTotals;
  const count = state.transactions.filter((item) => item.date.startsWith(state.selectedMonth)).length;
  const cards = element("div", "summary-grid");
  cards.append(summaryCard("Income", currency(state, totals.income), `${count} transaction${count === 1 ? "" : "s"} this month`, "↗"));
  cards.append(summaryCard("Expenses", currency(state, totals.expense), "Across all categories", "↘"));
  const previousMonth = new Date(`${state.selectedMonth}-01T12:00:00`);
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const previousEnd = monthBounds(monthKey(previousMonth)).end;
  const openingBalance = state.accounts.reduce((total, account) => total + account.openingBalanceMinor, 0);
  const carriedForward = openingBalance + state.transactions
    .filter((item) => item.date <= previousEnd)
    .reduce((balance, item) => balance + (item.type === "income" ? item.amountMinor : -item.amountMinor), 0);
  const monthlyNet = totals.income - totals.expense;
  const closingSavings = carriedForward + monthlyNet;
  const monthlyNetLabel = `${monthlyNet >= 0 ? "+" : "−"}${currency(state, Math.abs(monthlyNet))}`;
  cards.append(summaryCard("Net savings", currency(state, closingSavings), `Carried forward ${currency(state, carriedForward)} · This month ${monthlyNetLabel}`, "✦", true));
  root.append(cards);
  const { start, end } = monthBounds(state.selectedMonth);
  const categoryTotals = new Map();
  for (const transaction of state.transactions) {
    if (transaction.type !== "expense" || transaction.date < start || transaction.date > end) continue;
    categoryTotals.set(transaction.categoryId, (categoryTotals.get(transaction.categoryId) ?? 0) + transaction.amountMinor);
  }
  const expenseSlices = [...categoryTotals].map(([id, amount]) => ({
    category: state.categories.find((category) => category.id === id) ?? { name: "Other", color: "#8c9990" }, amount,
  })).sort((a, b) => b.amount - a.amount);
  const charts = element("div", "dashboard-grid");
  charts.append(donutPanel(state, expenseSlices), trendPanel(state));
  root.append(charts);
  const recent = element("section", "panel recent-panel");
  const section = element("div", "section-heading");
  section.append(element("h2", "", `Recent activity · ${monthTitle}`), makeButton("See all →", "show-transactions"));
  recent.append(section);
  const list = element("div", "transaction-list");
  const latest = state.transactions.filter((item) => item.date >= start && item.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  if (latest.length) latest.forEach((item) => list.append(transactionRow(item, state)));
  else list.append(element("div", "empty-state", "No transactions yet this month. Add your first one to get started."));
  recent.append(list);
  root.append(recent);
}
