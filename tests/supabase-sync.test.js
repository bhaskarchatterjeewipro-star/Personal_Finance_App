import assert from "node:assert/strict";
import test from "node:test";
import { fromSupabaseRow, toSupabaseRow } from "../js/supabase-sync.js";

test("transaction records round-trip through the normalized Supabase columns", () => {
  const record = {
    id: "txn-1",
    type: "expense",
    amountMinor: 1250,
    date: "2026-11-15",
    categoryId: "food",
    accountId: "bank",
    note: "Lunch",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:01:00.000Z",
  };
  const row = toSupabaseRow("transactions", record, "user-1");

  assert.equal(row.user_id, "user-1");
  assert.equal(row.amount_minor, 1250);
  assert.equal(row.category_id, "food");
  assert.deepEqual(fromSupabaseRow("transactions", row), record);
});

test("deletions become timestamped soft-delete rows", () => {
  const record = {
    id: "goal-1",
    name: "Rainy day",
    targetMinor: 10000,
    targetDate: "",
    savedMinor: 2500,
    updatedAt: "2026-11-15T10:01:00.000Z",
  };
  const row = toSupabaseRow("goals", record, "user-1", record.updatedAt);

  assert.equal(row.deleted_at, record.updatedAt);
  assert.equal(row.target_date, null);
  assert.equal(row.saved_minor, 2500);
});

test("out-of-range amounts are rejected before reaching the database", () => {
  assert.throws(
    () => toSupabaseRow("budgets", {
      id: "budget-1",
      categoryId: "food",
      month: "2026-11",
      limitMinor: Number.MAX_SAFE_INTEGER + 1,
    }, "user-1"),
    /supported amount range/,
  );
});
