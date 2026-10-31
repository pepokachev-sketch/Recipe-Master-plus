import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyState, validateState, DATA_MANAGER_SCHEMA, RecipeMasterDataManager } from '../src/indexeddb-data-manager.js';

const validState = () => ({
  recipes: [{ id: 'r1', name: 'Soup' }],
  meatNotes: [{ id: 'm1', name: 'Sausage' }],
  shopping: [{ id: 's1', text: 'Salt' }],
  customCategories: [{ id: 'c1', name: 'Dinner' }]
});

test('validates and clones all four state collections', () => {
  const input = validState();
  const output = validateState(input);
  assert.deepEqual(output, input);
  output.recipes[0].name = 'Changed';
  assert.equal(input.recipes[0].name, 'Soup');
});

test('rejects missing collections and non-array collections', () => {
  assert.throws(() => validateState({ recipes: [] }), /invalid-collection/);
  const state = validState();
  state.shopping = {};
  assert.throws(() => validateState(state), /invalid-collection:shopping/);
});

test('rejects malformed records, missing IDs and duplicate IDs', () => {
  const malformed = validState();
  malformed.recipes = [null];
  assert.throws(() => validateState(malformed), /invalid-record:recipes/);

  const missingId = validState();
  missingId.shopping = [{ text: 'Pepper' }];
  assert.throws(() => validateState(missingId), /missing-record-id:shopping/);

  const duplicateId = validState();
  duplicateId.meatNotes = [{ id: 'same' }, { id: 'same' }];
  assert.throws(() => validateState(duplicateId), /duplicate-record-id:meatNotes:same/);
});

test('parses legacy LocalStorage and treats absent keys as empty arrays', () => {
  const values = new Map([
    ['myrecipes_v1', JSON.stringify([{ id: 'r1' }])],
    ['mymeat_v1', JSON.stringify([])],
    ['myshop_v1', JSON.stringify([{ id: 's1' }])]
  ]);
  const storage = { getItem: key => values.has(key) ? values.get(key) : null };
  const state = parseLegacyState(storage);
  assert.equal(state.recipes.length, 1);
  assert.equal(state.meatNotes.length, 0);
  assert.equal(state.shopping.length, 1);
  assert.equal(state.customCategories.length, 0);
});

test('rejects invalid legacy JSON and invalid legacy collection shape', () => {
  const invalidJson = { getItem: key => key === 'myrecipes_v1' ? '{bad' : null };
  assert.throws(() => parseLegacyState(invalidJson), /legacy-json-invalid/);

  const invalidShape = { getItem: key => key === 'myrecipes_v1' ? JSON.stringify({}) : null };
  assert.throws(() => parseLegacyState(invalidShape), /invalid-collection:recipes/);
});

test('documents an isolated state database separate from image storage', () => {
  assert.equal(DATA_MANAGER_SCHEMA.database, 'recipe-master-plus-data');
  assert.deepEqual(DATA_MANAGER_SCHEMA.stores, ['appState', 'metadata']);
  assert.equal(DATA_MANAGER_SCHEMA.stores.includes('images'), false);
});


function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    snapshot: () => Object.fromEntries(values)
  };
}

test('migrates all four legacy collections atomically and keeps LocalStorage intact', async () => {
  const legacy = memoryStorage({
    myrecipes_v1: JSON.stringify([{ id: 'r1', name: 'Soup' }]),
    mymeat_v1: JSON.stringify([{ id: 'm1' }]),
    myshop_v1: JSON.stringify([{ id: 's1' }]),
    myrecipes_customcats_v1: JSON.stringify([{ id: 'c1' }])
  });
  const before = legacy.snapshot();
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: 'rmp-migration-' + crypto.randomUUID() });
  const result = await manager.initializeFromLegacy(legacy);
  assert.equal(result.status, 'migrated');
  assert.deepEqual(result.counts, { recipes: 1, meatNotes: 1, shopping: 1, customCategories: 1 });
  assert.deepEqual(await manager.loadState(), result.state);
  assert.deepEqual(legacy.snapshot(), before);
});

test('does not mark malformed legacy data authoritative', async () => {
  const legacy = memoryStorage({ myrecipes_v1: '{invalid' });
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: 'rmp-invalid-' + crypto.randomUUID() });
  await assert.rejects(manager.initializeFromLegacy(legacy), /legacy-json-invalid/);
  assert.equal(await manager.loadState(), null);
});

test('commits state and increments metadata revision only after transaction completion', async () => {
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: 'rmp-commit-' + crypto.randomUUID() });
  const storage = memoryStorage();
  await manager.initializeFromLegacy(storage);
  const next = validState();
  next.recipes.push({ id: 'r2', name: 'Bread' });
  const result = await manager.commitState(next);
  assert.equal(result.committed, true);
  assert.deepEqual(await manager.loadState(), next);
  const meta = await manager.readMetadata();
  assert.equal(meta.revision, 1);
  assert.equal(meta.counts.recipes, 2);
});

test('serializes concurrent commits and preserves the last queued state', async () => {
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: 'rmp-queue-' + crypto.randomUUID() });
  await manager.initializeFromLegacy(memoryStorage());
  const first = validState();
  first.recipes.push({ id: 'r2' });
  const second = validState();
  second.recipes.push({ id: 'r3' });
  await Promise.all([manager.commitState(first), manager.commitState(second)]);
  assert.deepEqual(await manager.loadState(), second);
  assert.equal((await manager.readMetadata()).revision, 2);
});

test('rejects a failed readwrite transaction and leaves previous committed state intact', async () => {
  const dbName = 'rmp-abort-' + crypto.randomUUID();
  let abortNextWrite = false;
  const wrappedFactory = {
    open(name, version) {
      const request = indexedDB.open(name, version);
      request.addEventListener('success', () => {
        const db = request.result;
        if (db.__rmpWrapped) return;
        db.__rmpWrapped = true;
        const originalTransaction = db.transaction.bind(db);
        db.transaction = (...args) => {
          const tx = originalTransaction(...args);
          if (abortNextWrite && args[1] === 'readwrite') {
            abortNextWrite = false;
            const originalObjectStore = tx.objectStore.bind(tx);
            tx.objectStore = name => {
              const store = originalObjectStore(name);
              if (name !== 'appState') return store;
              const originalPut = store.put.bind(store);
              let firstPut = true;
              store.put = value => {
                const request = originalPut(value);
                if (firstPut) {
                  firstPut = false;
                  tx.abort();
                }
                return request;
              };
              return store;
            };
          }
          return tx;
        };
      });
      return request;
    }
  };
  const manager = new RecipeMasterDataManager({ indexedDB: wrappedFactory, dbName });
  const original = validState();
  await manager.initializeFromLegacy(memoryStorage({
    myrecipes_v1: JSON.stringify(original.recipes),
    mymeat_v1: JSON.stringify(original.meatNotes),
    myshop_v1: JSON.stringify(original.shopping),
    myrecipes_customcats_v1: JSON.stringify(original.customCategories)
  }));
  const attempted = validState();
  attempted.recipes.push({ id: 'not-committed' });
  abortNextWrite = true;
  await assert.rejects(manager.commitState(attempted));
  assert.deepEqual(await manager.loadState(), original);
});
