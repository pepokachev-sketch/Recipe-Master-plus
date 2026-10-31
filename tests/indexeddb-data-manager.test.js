import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyState, validateState, DATA_MANAGER_SCHEMA } from '../src/indexeddb-data-manager.js';

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
