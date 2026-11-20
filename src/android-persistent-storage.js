const COLLECTIONS = Object.freeze(['recipes', 'meatNotes', 'shopping', 'customCategories']);
const KEY_TO_COLLECTION = Object.freeze({
  myrecipes_v1: 'recipes',
  mymeat_v1: 'meatNotes',
  myshop_v1: 'shopping',
  myrecipes_customcats_v1: 'customCategories'
});

let cachedNativePlugin = null;
export function getPersistentStoragePlugin() {
  if (cachedNativePlugin) return cachedNativePlugin;
  const capacitor = globalThis.Capacitor;
  if (typeof capacitor?.registerPlugin === 'function') {
    cachedNativePlugin = capacitor.registerPlugin('RmpPersistentStorage');
    return cachedNativePlugin;
  }
  cachedNativePlugin = capacitor?.Plugins?.RmpPersistentStorage || null;
  return cachedNativePlugin;
}

export function validatePersistentState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('persistent-state-invalid');
  }
  const state = {};
  for (const name of COLLECTIONS) {
    if (!Array.isArray(value[name])) throw new TypeError('persistent-collection-invalid:' + name);
    if (value[name].some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
      throw new TypeError('persistent-record-invalid:' + name);
    }
    state[name] = value[name];
  }
  if (state.recipes.some(record => typeof record.name !== 'string')) throw new TypeError('persistent-recipe-invalid');
  if (state.shopping.some(record => typeof record.text !== 'string')) throw new TypeError('persistent-shopping-invalid');
  if (state.customCategories.some(record => typeof record.name !== 'string' || !record.name.trim())) {
    throw new TypeError('persistent-category-invalid');
  }
  return state;
}

export function collectionForLegacyKey(key) {
  return KEY_TO_COLLECTION[key] || null;
}

export function imageRelativePath(id) {
  const safeId = String(id || '');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(safeId)) throw new TypeError('persistent-image-id-invalid');
  return 'Images/' + safeId;
}

export async function preparePersistentStorage(plugin = getPersistentStoragePlugin(), options = {}) {
  if (!plugin) return { supported: false, granted: false, active: false, plugin: null, state: null };
  let permission;
  try {
    permission = await plugin.checkAccess();
    if (!permission?.granted && options.requestPermission !== false) {
      permission = await plugin.requestAccess();
    }
  } catch (error) {
    return {
      supported: true,
      granted: false,
      active: false,
      plugin,
      state: null,
      permissionError: String(error)
    };
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
  imageRelativePath(id);
  await storage.plugin.writeImage({ id: String(id), dataUrl });
  const verified = await storage.plugin.readImage({ id: String(id) });
  if (!verified?.found || verified.dataUrl !== dataUrl) throw new Error('persistent-image-verification-failed:' + id);
  return 'Images/' + String(id);
}

export async function readPersistentImage(storage, id) {
  if (!storage?.granted || !storage.plugin) return null;
  imageRelativePath(id);
  const result = await storage.plugin.readImage({ id: String(id) });
  if (!result?.found || typeof result.dataUrl !== 'string') return null;
  if (!/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(result.dataUrl)) {
    throw new Error('persistent-image-file-invalid:' + id);
  }
  return result.dataUrl;
}

export async function savePersistentState(storage, inputState) {
  if (!storage?.granted || !storage.plugin) throw new Error('persistent-storage-not-granted');
  const state = validatePersistentState(inputState);
  return storage.plugin.saveState(state);
}
