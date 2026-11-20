import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePersistentState,
  collectionForLegacyKey,
  imageRelativePath,
  writePersistentImage,
  readPersistentImage,
  savePersistentState
} from '../src/android-persistent-storage.js';

const state = () => ({
  recipes: [{ id: 'r1', name: 'Soup' }],
  meatNotes: [],
  shopping: [{ id: 's1', text: 'Salt' }],
  customCategories: [{ name: 'Домашни' }]
});

test('validates the four persisted collections without rewriting records', () => {
  assert.deepEqual(validatePersistentState(state()), state());
  assert.throws(() => validatePersistentState({ recipes: [] }), /persistent-collection-invalid/);
});

test('maps legacy LocalStorage keys to their persistent collection names', () => {
  assert.equal(collectionForLegacyKey('myrecipes_v1'), 'recipes');
  assert.equal(collectionForLegacyKey('mymeat_v1'), 'meatNotes');
  assert.equal(collectionForLegacyKey('myshop_v1'), 'shopping');
  assert.equal(collectionForLegacyKey('myrecipes_customcats_v1'), 'customCategories');
  assert.equal(collectionForLegacyKey('other'), null);
});

test('restricts image paths to validated IDs under the Images directory', () => {
  assert.equal(imageRelativePath('img-123'), 'Images/img-123');
  assert.throws(() => imageRelativePath('../outside'), /persistent-image-id-invalid/);
});

test('writes and verifies portable image files through the native bridge', async () => {
  const files = new Map();
  const plugin = {
    writeImage: async ({ id, dataUrl }) => files.set(id, dataUrl),
    readImage: async ({ id }) => files.has(id) ? { found: true, dataUrl: files.get(id) } : { found: false }
  };
  const storage = { granted: true, plugin };
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  assert.equal(await writePersistentImage(storage, 'img-1', dataUrl), 'Images/img-1');
  assert.equal(await readPersistentImage(storage, 'img-1'), dataUrl);
});

test('rejects corrupt images and safely handles unavailable persistent storage', async () => {
  const storage = { granted: true, plugin: { readImage: async () => ({ found: true, dataUrl: 'not-an-image' }) } };
  await assert.rejects(readPersistentImage(storage, 'img-2'), /persistent-image-file-invalid/);
  assert.equal(await readPersistentImage({ granted: false }, 'img-2'), null);
});

test('commits a validated full state through the native SQLite bridge', async () => {
  let committed;
  const storage = { granted: true, plugin: { saveState: async value => { committed = value; return { saved: true }; } } };
  const result = await savePersistentState(storage, state());
  assert.equal(result.saved, true);
  assert.deepEqual(committed, state());
});
