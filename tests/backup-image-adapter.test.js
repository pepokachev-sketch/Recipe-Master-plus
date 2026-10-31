import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeBackupImages, restoreBackupImages } from '../src/backup-image-adapter.js';

const png = 'data:image/png;base64,aGVsbG8=';
const stateWithImages = () => ({
  recipes: [
    { id: 'r1', name: 'Soup', img: 'idb:blob-1' },
    { id: 'r2', name: 'Bread', img: 'idb:blob-1' },
    { id: 'r3', name: 'Salad', img: png }
  ],
  meatNotes: [],
  shopping: [],
  customCategories: [{ name: 'Домашни', photo: 'idb:blob-2' }]
});

test('exports Blob-backed image references and preserves legacy data URLs', async () => {
  const input = stateWithImages();
  const reads = [];
  const output = await serializeBackupImages(input, async id => {
    reads.push(id);
    return id === 'blob-1' ? png : 'data:image/jpeg;base64,amF2YQ==';
  });
  assert.equal(output.recipes[0].img, png);
  assert.equal(output.recipes[1].img, png);
  assert.equal(output.recipes[2].img, png);
  assert.equal(output.customCategories[0].photo, 'data:image/jpeg;base64,amF2YQ==');
  assert.deepEqual(reads, ['blob-1', 'blob-2']);
  assert.equal(input.recipes[0].img, 'idb:blob-1');
});

test('export fails closed for missing or corrupt images without mutating input', async () => {
  const input = stateWithImages();
  await assert.rejects(
    serializeBackupImages(input, async () => null),
    /backup-image-invalid/
  );
  await assert.rejects(
    serializeBackupImages(input, async () => 'data:image/png;base64,not valid!'),
    /backup-image-invalid/
  );
  assert.equal(input.recipes[0].img, 'idb:blob-1');
});

test('restore stages and verifies images before committing state; duplicate data URLs share one image', async () => {
  const input = {
    recipes: [{ id: 'r1', img: png }, { id: 'r2', img: png }],
    meatNotes: [],
    shopping: [],
    customCategories: [{ name: 'Домашни', photo: png }]
  };
  const imageStore = new Map();
  const writes = [];
  let committed = null;
  const result = await restoreBackupImages(input, {
    makeId: (() => { let n = 0; return () => 'restore-' + (++n); })(),
    writeImage: async (id, data) => { writes.push(id); imageStore.set(id, data); },
    readImage: async id => imageStore.get(id),
    commitState: async state => { committed = state; }
  });
  assert.deepEqual(writes, ['restore-1']);
  assert.equal(result.uniqueImages, 1);
  assert.equal(result.state.recipes[0].img, 'idb:restore-1');
  assert.equal(result.state.recipes[1].img, 'idb:restore-1');
  assert.equal(result.state.customCategories[0].photo, 'idb:restore-1');
  assert.equal(committed, result.state);
  assert.equal(input.recipes[0].img, png);
});

test('restore refuses to commit if any staged image is missing or corrupt', async () => {
  let commitCalls = 0;
  await assert.rejects(
    restoreBackupImages({ recipes: [{ id: 'r1', img: png }], customCategories: [] }, {
      makeId: () => 'broken',
      writeImage: async () => {},
      readImage: async () => null,
      commitState: async () => { commitCalls++; }
    }),
    /backup-image-invalid/
  );
  assert.equal(commitCalls, 0);
});

test('restore leaves prior state untouched when the state commit fails', async () => {
  const imageStore = new Map();
  let commitCalls = 0;
  await assert.rejects(
    restoreBackupImages({ recipes: [{ id: 'r1', img: png }], customCategories: [] }, {
      makeId: () => 'staged-only',
      writeImage: async (id, data) => imageStore.set(id, data),
      readImage: async id => imageStore.get(id),
      commitState: async () => { commitCalls++; throw new Error('state-transaction-aborted'); }
    }),
    /state-transaction-aborted/
  );
  assert.equal(commitCalls, 1);
  assert.equal(imageStore.get('staged-only'), png);
});

test('restore rejects non-portable idb references in incoming backup files', async () => {
  let commitCalls = 0;
  await assert.rejects(
    restoreBackupImages({ recipes: [{ id: 'r1', img: 'idb:private-id' }], customCategories: [] }, {
      makeId: () => 'unused',
      writeImage: async () => {},
      readImage: async () => null,
      commitState: async () => { commitCalls++; }
    }),
    /backup-image-reference-not-portable/
  );
  assert.equal(commitCalls, 0);
});

test('restore commits normally when there are no images', async () => {
  let committed = false;
  const result = await restoreBackupImages({ recipes: [], meatNotes: [], shopping: [], customCategories: [] }, {
    writeImage: async () => assert.fail('unexpected image write'),
    readImage: async () => assert.fail('unexpected image read'),
    commitState: async () => { committed = true; }
  });
  assert.equal(committed, true);
  assert.equal(result.uniqueImages, 0);
});
