const DB_NAME = "paisa-finance";
const DB_VERSION = 2;
const STORES = ["transactions", "categories", "budgets", "accounts", "goals", "recurring"];
const OUTBOX = "pending_changes";
let syncHandler = null;

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Database request failed"));
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onerror = () => reject(transaction.error ?? new Error("Database transaction failed."));
  transaction.onabort = () => reject(transaction.error ?? new Error("Database transaction was aborted."));
});

function notifySync() {
  if (!syncHandler) return;
  Promise.resolve().then(syncHandler).catch((error) => console.error("Background sync failed.", error));
}

function pendingKey(storeName, id) {
  return `${storeName}:${id}`;
}

function nextUpdatedAt(...timestamps) {
  const previous = timestamps.map((value) => Date.parse(value ?? "")).filter(Number.isFinite);
  return new Date(Math.max(Date.now(), ...previous.map((value) => value + 1))).toISOString();
}

export function setSyncHandler(handler) {
  syncHandler = handler;
}

export async function openDatabase(name = DB_NAME) {
  if (!("indexedDB" in window)) throw new Error("This browser does not support local database storage.");
  const request = indexedDB.open(name, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    for (const store of STORES) {
      if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(OUTBOX)) database.createObjectStore(OUTBOX, { keyPath: "key" });
  };
  return requestResult(request);
}

export function readAll(database, storeName) {
  return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

export function readPendingChanges(database) {
  return requestResult(database.transaction(OUTBOX, "readonly").objectStore(OUTBOX).getAll());
}

export async function writeRecord(database, storeName, record) {
  const transaction = database.transaction([storeName, OUTBOX], "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(storeName);
  const outbox = transaction.objectStore(OUTBOX);
  const key = pendingKey(storeName, record.id);
  const recordRequest = store.get(record.id);
  const pendingRequest = outbox.get(key);
  let normalized;
  let currentRecord;
  let currentChange;
  let reads = 0;
  const commit = () => {
    reads += 1;
    if (reads !== 2) return;
    normalized = {
      ...record,
      updatedAt: nextUpdatedAt(currentRecord?.updatedAt, currentChange?.updatedAt, record.updatedAt),
    };
    store.put(normalized);
    outbox.put({
      key,
      store: storeName,
      id: normalized.id,
      action: "upsert",
      record: normalized,
      updatedAt: normalized.updatedAt,
    });
  };
  recordRequest.onsuccess = () => { currentRecord = recordRequest.result; commit(); };
  pendingRequest.onsuccess = () => { currentChange = pendingRequest.result; commit(); };
  await done;
  notifySync();
  return normalized;
}

export async function deleteRecord(database, storeName, id) {
  const [record, existingChange] = await Promise.all([
    requestResult(database.transaction(storeName, "readonly").objectStore(storeName).get(id)),
    requestResult(database.transaction(OUTBOX, "readonly").objectStore(OUTBOX).get(pendingKey(storeName, id))),
  ]);
  const updatedAt = nextUpdatedAt(record?.updatedAt, existingChange?.updatedAt);
  const snapshot = record ?? existingChange?.record ?? null;
  const tombstone = snapshot ? { ...snapshot, updatedAt } : null;
  const transaction = database.transaction([storeName, OUTBOX], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(storeName).delete(id);
  transaction.objectStore(OUTBOX).put({
    key: pendingKey(storeName, id),
    store: storeName,
    id,
    action: "delete",
    record: tombstone,
    updatedAt,
  });
  await done;
  notifySync();
}

export async function seedStore(database, storeName, records) {
  const existing = await readAll(database, storeName);
  if (existing.length) return;
  if (!records.length) return;
  const timestamp = new Date().toISOString();
  const pending = await readPendingChanges(database);
  const pendingByKey = new Map(pending.map((change) => [change.key, change]));
  const transaction = database.transaction([storeName, OUTBOX], "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(storeName);
  const outbox = transaction.objectStore(OUTBOX);
  for (const item of records) {
    const key = pendingKey(storeName, item.id);
    const record = { ...item, updatedAt: nextUpdatedAt(timestamp, pendingByKey.get(key)?.updatedAt, item.updatedAt) };
    store.put(record);
    outbox.put({
      key,
      store: storeName,
      id: record.id,
      action: "upsert",
      record,
      updatedAt: record.updatedAt,
    });
  }
  await done;
  notifySync();
}

export async function keepMainBankAccount(database) {
  const [accounts, transactions, recurring] = await Promise.all([
    readAll(database, "accounts"),
    readAll(database, "transactions"),
    readAll(database, "recurring"),
  ]);
  const existingBank = accounts.find((account) => account.id === "bank")
    ?? accounts.find((account) => account.name.toLowerCase() === "main bank");
  const openingBalanceMinor = accounts.reduce((total, account) => {
    if (!Number.isSafeInteger(account.openingBalanceMinor)) throw new Error("An account has an invalid opening balance.");
    const balance = total + account.openingBalanceMinor;
    if (!Number.isSafeInteger(balance)) throw new Error("Combined account opening balances exceed the supported amount.");
    return balance;
  }, 0);
  const mainBank = {
    ...existingBank,
    id: "bank",
    name: "Main Bank",
    kind: "bank",
    openingBalanceMinor,
  };
  const isConsolidated = accounts.length === 1 && accounts[0].id === "bank"
    && accounts[0].name === "Main Bank" && accounts[0].kind === "bank"
    && accounts[0].openingBalanceMinor === openingBalanceMinor;
  if (!isConsolidated) {
    for (const account of accounts) {
      if (account.id !== mainBank.id) await deleteRecord(database, "accounts", account.id);
    }
    await writeRecord(database, "accounts", mainBank);
    for (const transaction of transactions) {
      if (transaction.accountId !== "bank") await writeRecord(database, "transactions", { ...transaction, accountId: "bank" });
    }
    for (const rule of recurring) {
      if (rule.accountId !== "bank") await writeRecord(database, "recurring", { ...rule, accountId: "bank" });
    }
  }
  return mainBank;
}

export async function replaceAll(database, collections) {
  const [existingRecords, existingPending] = await Promise.all([
    Promise.all(STORES.map(async (store) => [store, await readAll(database, store)])),
    readPendingChanges(database),
  ]);
  const existingCollections = Object.fromEntries(existingRecords);
  const pendingByKey = new Map(existingPending.map((change) => [change.key, change]));
  const timestamp = new Date().toISOString();
  const transaction = database.transaction([...STORES, OUTBOX], "readwrite");
  const done = transactionDone(transaction);
  const outbox = transaction.objectStore(OUTBOX);
  for (const store of STORES) {
    const objectStore = transaction.objectStore(store);
    const nextRecords = collections[store] ?? [];
    const nextIds = new Set(nextRecords.map((record) => record.id));
    for (const previous of existingCollections[store]) {
      if (!nextIds.has(previous.id)) {
        const key = pendingKey(store, previous.id);
        const record = {
          ...previous,
          updatedAt: nextUpdatedAt(timestamp, previous.updatedAt, pendingByKey.get(key)?.updatedAt),
        };
        outbox.put({
          key, store, id: previous.id,
          action: "delete", record, updatedAt: record.updatedAt,
        });
      }
    }
    objectStore.clear();
    for (const item of nextRecords) {
      const previous = existingCollections[store].find((candidate) => candidate.id === item.id);
      const key = pendingKey(store, item.id);
      const record = {
        ...item,
        updatedAt: nextUpdatedAt(timestamp, item.updatedAt, previous?.updatedAt, pendingByKey.get(key)?.updatedAt),
      };
      objectStore.put(record);
      outbox.put({
        key, store, id: record.id,
        action: "upsert", record, updatedAt: record.updatedAt,
      });
    }
  }
  await done;
  notifySync();
}

export async function clearDatabase(database) {
  const transaction = database.transaction([...STORES, OUTBOX], "readwrite");
  const done = transactionDone(transaction);
  for (const storeName of [...STORES, OUTBOX]) transaction.objectStore(storeName).clear();
  await done;
}

export async function deleteDatabase(name) {
  if (!("indexedDB" in window)) throw new Error("This browser does not support local database storage.");
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error ?? new Error("Could not remove local database."));
    request.onblocked = () => reject(new Error("Local data was cleared, but another open Paisa tab is blocking database removal."));
  });
}

export async function applyRemoteRecord(database, storeName, record, deletedAt, remoteUpdatedAt) {
  const transaction = database.transaction([storeName, OUTBOX], "readwrite");
  const done = transactionDone(transaction);
  const pendingStore = transaction.objectStore(OUTBOX);
  const request = pendingStore.get(pendingKey(storeName, record.id));
  let applied = false;
  request.onsuccess = () => {
    const pending = request.result;
    if (pending && Date.parse(pending.updatedAt) > Date.parse(remoteUpdatedAt)) return;
    if (deletedAt) transaction.objectStore(storeName).delete(record.id);
    else transaction.objectStore(storeName).put(record);
    if (pending) pendingStore.delete(pending.key);
    applied = true;
  };
  await done;
  return applied;
}

export async function clearPendingChange(database, key, sentUpdatedAt) {
  const transaction = database.transaction(OUTBOX, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(OUTBOX);
  const request = store.get(key);
  request.onsuccess = () => {
    if (request.result?.updatedAt === sentUpdatedAt) store.delete(key);
  };
  await done;
}

export const storeNames = STORES;
