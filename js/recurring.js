import { writeRecord } from "./db.js";

export async function processRecurring(state, localDateString) {
  const today = localDateString();
  for (const rule of state.recurring) {
    let due = rule.nextDue;
    let safety = 0;
    while (due <= today && safety < 1000) {
      const id = `${rule.id}-${due}`;
      if (!state.transactions.some((item) => item.id === id)) {
        await writeRecord(state.database, "transactions", {
          id, type: rule.type, amountMinor: rule.amountMinor, date: due, categoryId: rule.categoryId,
          accountId: rule.accountId, note: rule.note, recurringId: rule.id, createdAt: new Date().toISOString(),
        });
      }
      const next = new Date(`${due}T12:00:00`);
      if (rule.frequency === "weekly") next.setDate(next.getDate() + 7);
      else if (rule.frequency === "monthly") {
        const day = rule.dayOfMonth ?? next.getDate();
        next.setDate(1); next.setMonth(next.getMonth() + 1);
        next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      } else {
        const month = next.getMonth(); const day = next.getDate();
        next.setDate(1); next.setFullYear(next.getFullYear() + 1); next.setMonth(month);
        next.setDate(Math.min(day, new Date(next.getFullYear(), month + 1, 0).getDate()));
      }
      due = localDateString(next); safety += 1;
    }
    if (due !== rule.nextDue) await writeRecord(state.database, "recurring", { ...rule, nextDue: due });
  }
}
