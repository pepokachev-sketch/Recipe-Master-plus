const COLLECTIONS = Object.freeze(['recipes', 'meatNotes', 'shopping', 'customCategories']);
const KEY_TO_COLLECTION = Object.freeze({
  myrecipes_v1: 'recipes',
  mymeat_v1: 'meatNotes',
  myshop_v1: 'shopping',
  myrecipes_customcats_v1: 'customCategories'
});

export function getPersistentStoragePlugin() {
  return globalThis.Capacitor?.Plugins?.RmpPersistentStorage || null;
}

export function validatePersistentState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('persistent-state-invalid');
  }
  const state = {};
  for (const name of COLLECTIONS) {
    if (!Array.isArray(value[name])) throw new TypeError('persistent-collection-invalid:' + name);
    state[name] = value[name];
  }
  return state;
}

export function collectionForLegacyKey(key) {
  return KEY_TO_COLLECTION[key] || null;
}

export function imageRelativePath(id) {
  const safeId = String(id || '');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(safeId)) throw new TypeError('persistent-image-id-invalid');
  return 'Images/' + safeId + '.txt';
}

export async function preparePersistentStorage(plugin = getPersistentStoragePlugin(), options = {}) {
  if (!plugin) return { supported: false, granted: false, active: false, plugin: null, state: null };
  let permission = await plugin.checkAccess();
  if (!permission?.granted && options.requestPermission !== false) {
    permission = await plugin.requestAccess();
  }
  if (!permission?.granted) {
    return { supported: true, granted: false, active: false, plugin, state: null, rootPath: permission?.rootPath || null };
  }
  const loaded = await plugin.loadState();
  const state = loaded?.found ? validatePersistentState(loaded) : null;
  return {
    supported: true,
    granted: true,
    active: !!state,
    plugin,
    state,
    revision: loaded?.revision ?? null,
    rootPath: permission.rootPath || null
  };
}

export async function writePersistentImage(storage, id, dataUrl) {
  if (!storage?.granted || !storage.plugin) throw new Error('persistent-storage-not-granted');
  if (typeof dataUrl !== 'string' || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(dataUrl)) {
    throw new TypeError('persistent-image-data-invalid');
  }
  const path = imageRelativePath(id);
  await storage.plugin.writeText({ path, content: dataUrl });
  const verified = await storage.plugin.readText({ path });
  if (!verified?.found || verified.content !== dataUrl) throw new Error('persistent-image-verification-failed:' + id);
  return path;
}

export async function readPersistentImage(storage, id) {
  if (!storage?.granted || !storage.plugin) return null;
  const result = await storage.plugin.readText({ path: imageRelativePath(id) });
  if (!result?.found || typeof result.content !== 'string') return null;
  if (!/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(result.content)) {
    throw new Error('persistent-image-file-invalid:' + id);
  }
  return result.content;
}

export async function savePersistentState(storage, inputState) {
  if (!storage?.granted || !storage.plugin) throw new Error('persistent-storage-not-granted');
  const state = validatePersistentState(inputState);
  return storage.plugin.saveState(state);
}
