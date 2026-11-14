const DB_NAME = "paisa-finance";
const DB_VERSION = 1;
const STORES = ["transactions", "categories", "budgets", "accounts", "goals", "recurring"];

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("Database request failed"));
});

export async function openDatabase() {
  if (!("indexedDB" in window)) throw new Error("This browser does not support local database storage.");
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    for (const store of STORES) {
      if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
    }
  };
  return requestResult(request);
}

export function readAll(database, storeName) {
  return requestResult(database.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

export async function writeRecord(database, storeName, record) {
  const tx = database.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(record);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error(`Could not save ${storeName}.`));
    tx.onabort = () => reject(tx.error ?? new Error(`Could not save ${storeName}.`));
  });
  return record;
}

export async function deleteRecord(database, storeName, id) {
  const tx = database.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(id);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error(`Could not delete from ${storeName}.`));
    tx.onabort = () => reject(tx.error ?? new Error(`Could not delete from ${storeName}.`));
  });
}

export async function seedStore(database, storeName, records) {
  const existing = await readAll(database, storeName);
  if (existing.length) return;
  const tx = database.transaction(storeName, "readwrite");
  for (const record of records) tx.objectStore(storeName).put(record);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error(`Could not initialize ${storeName}.`));
    tx.onabort = () => reject(tx.error ?? new Error(`Could not initialize ${storeName}.`));
  });
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
  const tx = database.transaction(["accounts", "transactions", "recurring"], "readwrite");
  tx.objectStore("accounts").clear();
  tx.objectStore("accounts").put(mainBank);
  for (const transaction of transactions) {
    if (transaction.accountId !== "bank") tx.objectStore("transactions").put({ ...transaction, accountId: "bank" });
  }
  for (const rule of recurring) {
    if (rule.accountId !== "bank") tx.objectStore("recurring").put({ ...rule, accountId: "bank" });
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error("Could not consolidate accounts."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not consolidate accounts."));
  });
  return mainBank;
}

export async function replaceAll(database, collections) {
  const tx = database.transaction(STORES, "readwrite");
  for (const store of STORES) {
    const objectStore = tx.objectStore(store);
    objectStore.clear();
    for (const item of collections[store] ?? []) objectStore.put(item);
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error("Could not restore the backup."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not restore the backup."));
  });
}

export const storeNames = STORES;
