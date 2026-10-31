/**
 * Recipe Master Plus — backup/image lifecycle adapter.
 *
 * Preparation module: deliberately not imported by index.html yet.
 * It isolates the actual backup image transformation rules so they can be
 * tested without DOM/FileReader/download UI dependencies.
 */
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertImageDataUrl(value, label) {
  if (typeof value !== 'string' || !IMAGE_DATA_URL.test(value)) {
    throw new Error('backup-image-invalid:' + label);
  }
  return value;
}

function collectImageFields(state) {
  const fields = [];
  (state.recipes || []).forEach((record, index) => {
    if (typeof record.img === 'string' && (record.img.startsWith('idb:') || record.img.startsWith('data:image/'))) {
      fields.push({ record, field: 'img', index, collection: 'recipes' });
    }
  });
  (state.customCategories || []).forEach((record, index) => {
    if (typeof record.photo === 'string' && (record.photo.startsWith('idb:') || record.photo.startsWith('data:image/'))) {
      fields.push({ record, field: 'photo', index, collection: 'customCategories' });
    }
  });
  return fields;
}

/**
 * Produces portable backup state. Blob-backed idb: references are resolved
 * through the application's existing rmpImageGet() compatibility function;
 * legacy data URLs are preserved unchanged.
 */
export async function serializeBackupImages(inputState, getImageDataUrl) {
  if (!inputState || typeof inputState !== 'object' || Array.isArray(inputState)) {
    throw new TypeError('backup-state-invalid');
  }
  if (typeof getImageDataUrl !== 'function') throw new TypeError('image-reader-required');
  const state = clone(inputState);
  const fields = collectImageFields(state);
  const cache = new Map();
  for (const item of fields) {
    const value = item.record[item.field];
    if (value.startsWith('data:image/')) {
      assertImageDataUrl(value, item.collection + ':' + item.index);
      continue;
    }
    const id = value.slice(4);
    if (!id) throw new Error('backup-image-reference-invalid:' + item.collection + ':' + item.index);
    if (!cache.has(id)) {
      const dataUrl = await getImageDataUrl(id);
      cache.set(id, assertImageDataUrl(dataUrl, item.collection + ':' + item.index));
    }
    item.record[item.field] = cache.get(id);
  }
  return state;
}

/**
 * Restores portable image data safely:
 * 1. validate and stage every image before touching application state;
 * 2. deduplicate identical data URLs;
 * 3. read each staged image back and validate it;
 * 4. replace data URLs with idb: references;
 * 5. commit state only after every image has passed verification.
 *
 * On failure, no state commit is attempted. Staged images are intentionally
 * not deleted: some IDs may have pre-existed or be referenced elsewhere.
 */
export async function restoreBackupImages(inputState, options = {}) {
  const { writeImage, readImage, commitState } = options;
  const makeId = options.makeId || (() => 'img-' + globalThis.crypto.randomUUID());
  if (!inputState || typeof inputState !== 'object' || Array.isArray(inputState)) {
    throw new TypeError('backup-state-invalid');
  }
  if (typeof writeImage !== 'function' || typeof readImage !== 'function' || typeof commitState !== 'function') {
    throw new TypeError('restore-adapter-dependencies-required');
  }

  const state = clone(inputState);
  const fields = collectImageFields(state);
  const stagedByDataUrl = new Map();
  const stagedIds = [];

  for (const item of fields) {
    const value = item.record[item.field];
    if (value.startsWith('idb:')) {
      throw new Error('backup-image-reference-not-portable:' + item.collection + ':' + item.index);
    }
    const dataUrl = assertImageDataUrl(value, item.collection + ':' + item.index);
    let id = stagedByDataUrl.get(dataUrl);
    if (!id) {
      id = String(makeId());
      if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id)) throw new Error('restore-image-id-invalid');
      await writeImage(id, dataUrl);
      const verified = await readImage(id);
      assertImageDataUrl(verified, 'staged:' + id);
      if (verified !== dataUrl) throw new Error('restore-image-verification-failed:' + id);
      stagedByDataUrl.set(dataUrl, id);
      stagedIds.push(id);
    }
    item.record[item.field] = 'idb:' + id;
  }

  await commitState(state);
  return { committed: true, state, stagedImageIds: stagedIds, uniqueImages: stagedIds.length };
}
