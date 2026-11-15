import {
  applyRemoteRecord, clearPendingChange, readPendingChanges, setSyncHandler,
} from "./db.js";

const TABLES = {
  transactions: "transactions",
  categories: "categories",
  budgets: "budgets",
  accounts: "accounts",
  goals: "goals",
  recurring: "recurring",
};

let syncContext = null;
let syncPromise = null;
let rerunRequested = false;
let fullSyncRequested = false;
let lastSyncAvailable = false;
let lastRemoteHasData = false;

function assertSafeInteger(value, field) {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} is outside the supported amount range.`);
  return value;
}

function readMinor(value, field) {
  return assertSafeInteger(Number(value), field);
}

export function toSupabaseRow(store, record, userId, deletedAt = null) {
  const common = {
    id: record.id,
    user_id: userId,
    updated_at: record.updatedAt ?? new Date().toISOString(),
    deleted_at: deletedAt,
  };
  if (store === "transactions") return {
    ...common,
    type: record.type,
    amount_minor: assertSafeInteger(record.amountMinor, "Transaction amount"),
    date: record.date,
    category_id: record.categoryId,
    account_id: record.accountId,
    note: record.note ?? "",
    recurring_id: record.recurringId ?? null,
    created_at: record.createdAt ?? common.updated_at,
  };
  if (store === "categories") return {
    ...common, name: record.name, icon: record.icon, color: record.color, type: record.type,
  };
  if (store === "budgets") return {
    ...common,
    category_id: record.categoryId,
    month: record.month,
    limit_minor: assertSafeInteger(record.limitMinor, "Budget limit"),
  };
  if (store === "accounts") return {
    ...common,
    name: record.name,
    kind: record.kind,
    opening_balance_minor: assertSafeInteger(record.openingBalanceMinor, "Opening balance"),
  };
  if (store === "goals") return {
    ...common,
    name: record.name,
    target_minor: assertSafeInteger(record.targetMinor, "Goal target"),
    target_date: record.targetDate || null,
    saved_minor: assertSafeInteger(record.savedMinor, "Goal savings"),
  };
  if (store === "recurring") return {
    ...common,
    type: record.type,
    amount_minor: assertSafeInteger(record.amountMinor, "Recurring amount"),
    category_id: record.categoryId,
    account_id: record.accountId,
    frequency: record.frequency,
    next_due: record.nextDue,
    day_of_month: record.dayOfMonth ?? Number(String(record.nextDue).slice(8, 10)),
    note: record.note ?? "",
    created_at: record.createdAt ?? common.updated_at,
  };
  throw new Error(`Unknown local data store: ${store}`);
}

export function fromSupabaseRow(store, row) {
  const common = { id: row.id, updatedAt: row.updated_at };
  if (store === "transactions") {
    const record = {
      ...common,
      type: row.type,
      amountMinor: readMinor(row.amount_minor, "Transaction amount"),
      date: row.date,
      categoryId: row.category_id,
      accountId: row.account_id,
      note: row.note,
      createdAt: row.created_at,
    };
    if (row.recurring_id) record.recurringId = row.recurring_id;
    return record;
  }
  if (store === "categories") return {
    ...common, name: row.name, icon: row.icon, color: row.color, type: row.type,
  };
  if (store === "budgets") return {
    ...common, categoryId: row.category_id, month: row.month, limitMinor: readMinor(row.limit_minor, "Budget limit"),
  };
  if (store === "accounts") return {
    ...common,
    name: row.name,
    kind: row.kind,
    openingBalanceMinor: readMinor(row.opening_balance_minor, "Opening balance"),
  };
  if (store === "goals") return {
    ...common,
    name: row.name,
    targetMinor: readMinor(row.target_minor, "Goal target"),
    targetDate: row.target_date ?? "",
    savedMinor: readMinor(row.saved_minor, "Goal savings"),
  };
  if (store === "recurring") return {
    ...common,
    type: row.type,
    amountMinor: readMinor(row.amount_minor, "Recurring amount"),
    categoryId: row.category_id,
    accountId: row.account_id,
    frequency: row.frequency,
    nextDue: row.next_due,
    dayOfMonth: Number(row.day_of_month),
    note: row.note,
    createdAt: row.created_at,
  };
  throw new Error(`Unknown remote data store: ${store}`);
}

function publishStatus(state, message) {
  syncContext?.onStatus?.({ state, message });
}

async function fetchRemoteRows() {
  const collections = {};
  for (const [store, table] of Object.entries(TABLES)) {
    const { data, error } = await syncContext.client
      .from(table)
      .select("*")
      .eq("user_id", syncContext.user.id);
    if (error) throw error;
    collections[store] = data ?? [];
  }
  return collections;
}

async function pullRemote() {
  const remoteCollections = await fetchRemoteRows();
  lastRemoteHasData = Object.values(remoteCollections).some((records) => records.length > 0);

  for (const [store, rows] of Object.entries(remoteCollections)) {
    for (const row of rows) {
      const remote = fromSupabaseRow(store, row);
      await applyRemoteRecord(syncContext.database, store, remote, row.deleted_at, row.updated_at);
    }
  }
}

async function pushPending() {
  const pending = await readPendingChanges(syncContext.database);
  for (const store of Object.keys(TABLES)) {
    const changes = pending.filter((change) => change.store === store);
    const rows = changes
      .filter((change) => change.action === "upsert" || change.record)
      .map((change) => toSupabaseRow(
        store,
        change.record,
        syncContext.user.id,
        change.action === "delete" ? change.updatedAt : null,
      ));
    if (rows.length) {
      const { error } = await syncContext.client
        .from(TABLES[store])
        .upsert(rows, { onConflict: "user_id,id" });
      if (error) throw error;
    }
    for (const change of changes.filter((item) => item.action === "delete" && !item.record)) {
      const { error } = await syncContext.client
        .from(TABLES[store])
        .update({ deleted_at: change.updatedAt, updated_at: change.updatedAt })
        .eq("user_id", syncContext.user.id)
        .eq("id", change.id);
      if (error) throw error;
    }
    for (const change of changes) {
      await clearPendingChange(syncContext.database, change.key, change.updatedAt);
    }
  }
}

async function runSync(fullSync) {
  if (!syncContext) return;
  if (!navigator.onLine) {
    lastSyncAvailable = false;
    publishStatus("offline", "Offline — changes are saved on this device.");
    return;
  }
  publishStatus("syncing", "Syncing…");
  try {
    if (fullSync) await pullRemote();
    await pushPending();
    lastSyncAvailable = true;
    const remaining = await readPendingChanges(syncContext.database);
    publishStatus(remaining.length ? "pending" : "synced", remaining.length
      ? `${remaining.length} change${remaining.length === 1 ? "" : "s"} waiting to sync.`
      : "Synced");
  } catch (error) {
    lastSyncAvailable = false;
    console.error("Could not sync with Supabase.", error);
    publishStatus("error", `Sync error: ${error.message || "check the Supabase setup and connection."}`);
  }
}

export function requestSync(fullSync = false) {
  if (syncPromise) {
    rerunRequested = true;
    fullSyncRequested ||= fullSync;
    return syncPromise;
  }
  syncPromise = (async () => {
    let doFullSync = fullSync;
    do {
      rerunRequested = false;
      fullSyncRequested = false;
      await runSync(doFullSync);
      doFullSync = fullSyncRequested || (rerunRequested && doFullSync);
    } while (rerunRequested || fullSyncRequested);
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

export async function configureSync(context) {
  syncContext = context;
  setSyncHandler(() => requestSync(false));
  window.removeEventListener("online", handleOnline);
  window.addEventListener("online", handleOnline);
  await requestSync(true);
  if (!lastSyncAvailable) return "unavailable";
  return lastRemoteHasData ? "has-data" : "empty";
}

export function clearSync() {
  syncContext = null;
  setSyncHandler(null);
  publishStatus("idle", "");
}

function handleOnline() {
  if (syncContext) requestSync(true);
}
