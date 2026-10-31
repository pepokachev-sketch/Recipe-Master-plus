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

test('normalizes missing, invalid and duplicate legacy IDs in the migration snapshot', () => {
  const values = new Map([
    ['myrecipes_v1', JSON.stringify([{ name: 'Old recipe' }, { id: 'same', name: 'First' }, { id: 'same', name: 'Duplicate' }])],
    ['mymeat_v1', JSON.stringify([{ name: 'Old note' }])],
    ['myshop_v1', JSON.stringify([{ text: 'Salt' }, { id: 'bad id', text: 'Pepper' }])]
  ]);
  const storage = { getItem: key => values.has(key) ? values.get(key) : null };
  const before = Object.fromEntries(values);
  const state = parseLegacyState(storage);

  for (const collection of ['recipes', 'meatNotes', 'shopping']) {
    const ids = state[collection].map(record => record.id);
    assert.ok(ids.every(id => /^[A-Za-z0-9._:-]{1,100}$/.test(id)));
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.equal(state.recipes[1].id, 'same');
  assert.notEqual(state.recipes[2].id, 'same');
  assert.deepEqual(Object.fromEntries(values), before);
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
    myrecipes_customcats_v1: JSON.stringify([{ name: 'Dinner' }])
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


test('accepts real legacy custom categories without synthetic IDs', async () => {
  const legacy = memoryStorage({
    myrecipes_v1: JSON.stringify([{ id: 'r1', name: 'Soup', img: 'idb:img-existing-1' }]),
    mymeat_v1: JSON.stringify([]),
    myshop_v1: JSON.stringify([]),
    myrecipes_customcats_v1: JSON.stringify([
      { name: 'Домашни рецепти', description: 'Лични', photo: 'idb:img-category-1' }
    ])
  });
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: 'rmp-legacy-categories-' + crypto.randomUUID() });
  const result = await manager.initializeFromLegacy(legacy);
  assert.equal(result.status, 'migrated');
  assert.deepEqual(result.state.customCategories, [
    { name: 'Домашни рецепти', description: 'Лични', photo: 'idb:img-category-1' }
  ]);
  assert.equal(result.state.recipes[0].img, 'idb:img-existing-1');
});

test('preserves image references as opaque strings in recipe and category records', async () => {
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: 'rmp-image-refs-' + crypto.randomUUID() });
  const state = {
    recipes: [{ id: 'r1', name: 'Soup', img: 'idb:img-abc123' }],
    meatNotes: [],
    shopping: [],
    customCategories: [{ name: 'Супи', photo: 'idb:img-cat123' }]
  };
  await manager.initializeFromLegacy(memoryStorage({
    myrecipes_v1: JSON.stringify(state.recipes),
    mymeat_v1: '[]',
    myshop_v1: '[]',
    myrecipes_customcats_v1: JSON.stringify(state.customCategories)
  }));
  assert.deepEqual(await manager.loadState(), state);
});

test('concurrent migration attempts from two managers cannot overwrite a completed migration', async () => {
  const dbName = 'rmp-migration-race-' + crypto.randomUUID();
  const firstState = {
    recipes: [{ id: 'first', name: 'First' }],
    meatNotes: [],
    shopping: [],
    customCategories: [{ name: 'Първа категория' }]
  };
  const secondState = {
    recipes: [{ id: 'second', name: 'Second' }],
    meatNotes: [],
    shopping: [],
    customCategories: [{ name: 'Втора категория' }]
  };
  const storageFor = state => memoryStorage({
    myrecipes_v1: JSON.stringify(state.recipes),
    mymeat_v1: JSON.stringify(state.meatNotes),
    myshop_v1: JSON.stringify(state.shopping),
    myrecipes_customcats_v1: JSON.stringify(state.customCategories)
  });
  const first = new RecipeMasterDataManager({ indexedDB, dbName });
  const second = new RecipeMasterDataManager({ indexedDB, dbName });
  const results = await Promise.all([
    first.initializeFromLegacy(storageFor(firstState)),
    second.initializeFromLegacy(storageFor(secondState))
  ]);
  const finalState = await first.loadState();
  const isFirst = JSON.stringify(finalState) === JSON.stringify(validateState(firstState));
  const isSecond = JSON.stringify(finalState) === JSON.stringify(validateState(secondState));
  assert.equal(isFirst || isSecond, true);
  assert.equal(results.filter(x => x.status === 'migrated').length, 1);
  assert.equal(results.filter(x => x.status === 'already-initialized').length, 1);
});


test('keeps the image database separate while state commits preserve image pointers', async () => {
  const dataDbName = 'rmp-data-image-separation-' + crypto.randomUUID();
  const imageDbName = 'recipe-master-plus-images';
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: dataDbName });
  const imageOpen = indexedDB.open(imageDbName, 1);
  imageOpen.onupgradeneeded = () => imageOpen.result.createObjectStore('images', { keyPath: 'id' });
  const imageDb = await new Promise((resolve, reject) => {
    imageOpen.onsuccess = () => resolve(imageOpen.result);
    imageOpen.onerror = () => reject(imageOpen.error);
  });
  const imageBlob = new Blob(['image-bytes'], { type: 'image/png' });
  await new Promise((resolve, reject) => {
    const tx = imageDb.transaction('images', 'readwrite');
    tx.objectStore('images').put({
      id: 'img-independent',
      blob: imageBlob,
      mimeType: 'image/png',
      size: imageBlob.size
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  const state = {
    recipes: [{ id: 'r1', name: 'Soup', img: 'idb:img-independent' }],
    meatNotes: [],
    shopping: [],
    customCategories: [{ name: 'Супи', photo: 'idb:img-independent' }]
  };
  await manager.initializeFromLegacy(memoryStorage({
    myrecipes_v1: JSON.stringify(state.recipes),
    mymeat_v1: '[]',
    myshop_v1: '[]',
    myrecipes_customcats_v1: JSON.stringify(state.customCategories)
  }));
  const changed = structuredClone(state);
  changed.recipes[0].notes = 'updated';
  await manager.commitState(changed);

  const persistedImage = await new Promise((resolve, reject) => {
    const tx = imageDb.transaction('images', 'readonly');
    const request = tx.objectStore('images').get('img-independent');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(persistedImage.blob.size, imageBlob.size);
  assert.equal(persistedImage.blob.type, 'image/png');
  assert.deepEqual((await manager.loadState()).recipes[0].img, 'idb:img-independent');

  const dataDb = await manager.open();
  assert.deepEqual(Array.from(dataDb.objectStoreNames).sort(), ['appState', 'metadata']);
  assert.equal(dataDb.objectStoreNames.contains('images'), false);
  imageDb.close();
  dataDb.close();
});

test('legacy image data URLs remain data URLs during migration and are not mistaken for IndexedDB pointers', async () => {
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  const manager = new RecipeMasterDataManager({ indexedDB, dbName: 'rmp-legacy-dataurl-' + crypto.randomUUID() });
  const result = await manager.initializeFromLegacy(memoryStorage({
    myrecipes_v1: JSON.stringify([{ id: 'r1', name: 'Soup', img: dataUrl }]),
    mymeat_v1: '[]',
    myshop_v1: '[]',
    myrecipes_customcats_v1: '[]'
  }));
  assert.equal(result.state.recipes[0].img, dataUrl);
});


test('rejects null, array and primitive legacy records before creating an authoritative migration', async () => {
  const malformedRecords = [
    { label: 'null', value: null },
    { label: 'array', value: ['not', 'a', 'record'] },
    { label: 'string', value: 'not-a-record' },
    { label: 'number', value: 42 }
  ];

  for (const item of malformedRecords) {
    const rawRecipes = JSON.stringify([{ id: 'valid-before-malformed' }, item.value]);
    const legacy = memoryStorage({
      myrecipes_v1: rawRecipes,
      mymeat_v1: '[]',
      myshop_v1: '[]',
      myrecipes_customcats_v1: '[]'
    });
    const before = legacy.snapshot();
    const manager = new RecipeMasterDataManager({
      indexedDB,
      dbName: 'rmp-invalid-record-' + item.label + '-' + crypto.randomUUID()
    });

    await assert.rejects(
      manager.initializeFromLegacy(legacy),
      /invalid-record:recipes:1/
    );
    assert.deepEqual(legacy.snapshot(), before, 'legacy LocalStorage snapshot must remain unchanged');
    assert.equal(await manager.loadState(), null, 'malformed input must not create an authoritative marker');
    assert.equal(await manager.readMetadata(), null, 'malformed input must not create migration metadata');
  }
});

test('rejects malformed legacy records in non-recipe collections without changing LocalStorage', async () => {
  const cases = [
    { key: 'mymeat_v1', expected: /invalid-record:meatNotes:0/ },
    { key: 'myshop_v1', expected: /invalid-record:shopping:0/ },
    { key: 'myrecipes_customcats_v1', expected: /invalid-record:customCategories:0/ }
  ];

  for (const item of cases) {
    const legacy = memoryStorage({
      myrecipes_v1: '[]',
      mymeat_v1: '[]',
      myshop_v1: '[]',
      myrecipes_customcats_v1: '[]',
      [item.key]: JSON.stringify([null])
    });
    const before = legacy.snapshot();
    const manager = new RecipeMasterDataManager({
      indexedDB,
      dbName: 'rmp-invalid-collection-record-' + crypto.randomUUID()
    });

    await assert.rejects(manager.initializeFromLegacy(legacy), item.expected);
    assert.deepEqual(legacy.snapshot(), before);
    assert.equal(await manager.loadState(), null);
    assert.equal(await manager.readMetadata(), null);
  }
});

test('generated migration IDs do not collide with later valid legacy IDs', () => {
  const legacy = memoryStorage({
    myrecipes_v1: JSON.stringify([
      { id: 'existing' },
      { name: 'Missing ID gets a generated value' },
      { id: 'recipe-migrated-1', name: 'Pre-existing generated-looking ID' }
    ]),
    mymeat_v1: '[]',
    myshop_v1: '[]',
    myrecipes_customcats_v1: '[]'
  });
  const before = legacy.snapshot();
  const state = parseLegacyState(legacy);
  const ids = state.recipes.map(record => record.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[2], 'recipe-migrated-1');
  assert.notEqual(ids[1], ids[2]);
  assert.deepEqual(legacy.snapshot(), before);
});
