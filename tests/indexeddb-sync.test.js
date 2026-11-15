import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  applyRemoteRecord, clearDatabase, deleteDatabase, deleteRecord, openDatabase, readAll, readPendingChanges, storeNames,
  writeRecord,
} from "../js/db.js";

globalThis.indexedDB = indexedDB;
globalThis.window = { indexedDB };

async function createDatabase() {
  const name = `paisa-test-${Date.now()}-${Math.random()}`;
  return { name, database: await openDatabase(name) };
}

async function removeDatabase(name) {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

test("offline writes are queued and older remote rows cannot overwrite them", async () => {
  const { name, database } = await createDatabase();
  try {
    const local = await writeRecord(database, "transactions", {
      id: "transaction-1",
      type: "expense",
      amountMinor: 1250,
      date: "2026-11-15",
      categoryId: "food",
      accountId: "bank",
      note: "Local edit",
    });
    const pending = await readPendingChanges(database);

    assert.equal(pending.length, 1);
    assert.equal(pending[0].action, "upsert");
    assert.equal(pending[0].record.note, "Local edit");

    const staleRemote = { ...local, note: "Stale cloud edit", updatedAt: new Date(Date.parse(local.updatedAt) - 1000).toISOString() };
    await applyRemoteRecord(database, "transactions", staleRemote, null, staleRemote.updatedAt);

    assert.equal((await readAll(database, "transactions"))[0].note, "Local edit");
    assert.equal((await readPendingChanges(database)).length, 1);
  } finally {
    database.close();
    await removeDatabase(name);
  }
});

test("deletions leave a sync tombstone with the deleted record snapshot", async () => {
  const { name, database } = await createDatabase();
  try {
    const category = await writeRecord(database, "categories", {
      id: "custom-category",
      name: "Travel",
      icon: "✈",
      color: "#739d70",
      type: "both",
    });
    await deleteRecord(database, "categories", category.id);

    const pending = await readPendingChanges(database);
    assert.equal((await readAll(database, "categories")).length, 0);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].action, "delete");
    assert.equal(pending[0].record.name, "Travel");
    assert.ok(Date.parse(pending[0].updatedAt) > Date.parse(category.updatedAt));
  } finally {
    database.close();
    await removeDatabase(name);
  }
});

test("permanent cleanup clears user records and the sync outbox without queueing deletes", async () => {
  const { name, database } = await createDatabase();
  try {
    await writeRecord(database, "transactions", {
      id: "transaction-1",
      type: "expense",
      amountMinor: 1250,
      date: "2026-11-15",
      categoryId: "food",
      accountId: "bank",
      note: "Local record",
    });
    await clearDatabase(database);
    for (const store of storeNames) assert.deepEqual(await readAll(database, store), []);
    assert.deepEqual(await readPendingChanges(database), []);
  } finally {
    database.close();
    await deleteDatabase(name);
  }
});
