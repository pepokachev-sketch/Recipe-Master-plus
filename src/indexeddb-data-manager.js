/**
 * Recipe Master Plus — isolated IndexedDB state manager.
 *
 * NOT WIRED INTO index.html. This module is a preparation artifact only.
 * Core application state and image blobs intentionally remain separate.
 */
const DEFAULT_DB_NAME = 'recipe-master-plus-data';
const DEFAULT_DB_VERSION = 1;
const COLLECTIONS = Object.freeze([
  'recipes',
  'meatNotes',
  'shopping',
  'customCategories'
]);
const LEGACY_KEYS = Object.freeze({
  recipes: 'myrecipes_v1',
  meatNotes: 'mymeat_v1',
  shopping: 'myshop_v1',
  customCategories: 'myrecipes_customcats_v1'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateCollection(name, value) {
  if (!Array.isArray(value)) {
    throw new TypeError('invalid-collection:' + name);
  }
  const ids = new Set();
  const categoryNames = new Set();
  value.forEach((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('invalid-record:' + name + ':' + index);
    }
    if (name === 'customCategories') {
      if (typeof record.name !== 'string' || !record.name.trim()) {
        throw new TypeError('missing-category-name:' + index);
      }
      const normalizedName = record.name.trim().toLocaleLowerCase('bg');
      if (categoryNames.has(normalizedName)) {
        throw new TypeError('duplicate-category-name:' + normalizedName);
      }
      categoryNames.add(normalizedName);
      // Existing application categories are keyed by name and legitimately have no id.
      if (record.id !== undefined && record.id !== null && String(record.id).trim() !== '') {
        const id = String(record.id);
        if (ids.has(id)) throw new TypeError('duplicate-record-id:' + name + ':' + id);
        ids.add(id);
      }
      return;
    }
    if (record.id === undefined || record.id === null || String(record.id).trim() === '') {
      throw new TypeError('missing-record-id:' + name + ':' + index);
    }
    const id = String(record.id);
    if (ids.has(id)) throw new TypeError('duplicate-record-id:' + name + ':' + id);
    ids.add(id);
  });
  return value;
}

export function validateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('invalid-state');
  }
  const state = {};
  COLLECTIONS.forEach(name => {
    state[name] = clone(validateCollection(name, input[name]));
  });
  return state;
}

export function normalizeLegacyRecordIds(state) {
  const prefixes = { recipes: 'recipe', meatNotes: 'note', shopping: 'shop' };
  Object.entries(prefixes).forEach(([collection, prefix]) => {
    if (!Array.isArray(state[collection])) {
      throw new TypeError('invalid-collection:' + collection);
    }
    const seen = new Set();
    state[collection].forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw new TypeError('invalid-record:' + collection + ':' + index);
      }
      let id = String(record.id ?? '');
      if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id) || seen.has(id)) {
        id = prefix + '-migrated-' + index.toString(36);
        while (seen.has(id)) id += 'x';
        record.id = id;
      }
      seen.add(id);
    });
  });
  return state;
}

function parseLegacyState(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new TypeError('legacy-storage-unavailable');
  }
  const state = {};
  COLLECTIONS.forEach(name => {
    const raw = storage.getItem(LEGACY_KEYS[name]);
    if (raw === null) {
      state[name] = [];
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error('legacy-json-invalid:' + LEGACY_KEYS[name], { cause: error });
    }
    state[name] = parsed;
  });
  // Match the running application's startup normalization before validating.
  // This changes only the in-memory migration snapshot; LocalStorage is untouched.
  normalizeLegacyRecordIds(state);
  return validateState(state);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb-request-failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('indexeddb-transaction-aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('indexeddb-transaction-failed'));
  });
}

function putRequest(store, value) {
  return requestResult(store.put(value));
}

function getRequest(store, key) {
  return requestResult(store.get(key));
}

export class RecipeMasterDataManager {
  constructor(options = {}) {
    this.indexedDB = options.indexedDB || globalThis.indexedDB;
    this.dbName = options.dbName || DEFAULT_DB_NAME;
    this.dbVersion = options.dbVersion || DEFAULT_DB_VERSION;
    this.dbPromise = null;
    this.commitQueue = Promise.resolve();
  }

  open() {
    if (!this.indexedDB) return Promise.reject(new Error('indexeddb-unavailable'));
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('appState')) {
          db.createObjectStore('appState', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('indexeddb-open-failed'));
      };
      request.onblocked = () => {
        this.dbPromise = null;
        reject(new Error('indexeddb-open-blocked'));
      };
    });
    return this.dbPromise;
  }

  async readMetadata() {
    const db = await this.open();
    const tx = db.transaction(['metadata'], 'readonly');
    const done = transactionDone(tx);
    const record = await getRequest(tx.objectStore('metadata'), 'state');
    await done;
    return record || null;
  }

  async loadState() {
    const db = await this.open();
    const tx = db.transaction(['appState', 'metadata'], 'readonly');
    const done = transactionDone(tx);
    const appStore = tx.objectStore('appState');
    const metaStore = tx.objectStore('metadata');
    const metaPromise = getRequest(metaStore, 'state');
    const valuePromises = COLLECTIONS.map(name => getRequest(appStore, name));
    const [meta, values] = await Promise.all([metaPromise, Promise.all(valuePromises)]);
    await done;
    if (!meta || meta.authoritative !== true) return null;
    const state = {};
    COLLECTIONS.forEach((name, index) => {
      if (!values[index] || !Object.prototype.hasOwnProperty.call(values[index], 'value')) {
        throw new Error('indexeddb-state-record-missing:' + name);
      }
      state[name] = values[index].value;
    });
    return validateState(state);
  }

  async initializeFromLegacy(storage) {
    // Parse before opening a write transaction so malformed legacy data cannot
    // create an authoritative marker or partially initialize the new database.
    const legacyState = parseLegacyState(storage);
    const counts = Object.fromEntries(COLLECTIONS.map(name => [name, legacyState[name].length]));
    const db = await this.open();
    const tx = db.transaction(['appState', 'metadata'], 'readwrite');
    const done = transactionDone(tx);
    const appStore = tx.objectStore('appState');
    const metaStore = tx.objectStore('metadata');

    // A readwrite transaction serializes initialization across tabs. The marker
    // is checked inside that transaction, not in a preceding readonly request.
    let didMigrate = false;
    const markerRequest = metaStore.get('state');
    markerRequest.onsuccess = () => {
      const existing = markerRequest.result;
      if (existing?.authoritative === true) return;
      didMigrate = true;
      COLLECTIONS.forEach(name => {
        appStore.put({ key: name, value: legacyState[name] });
      });
      metaStore.put({
        key: 'state',
        schemaVersion: this.dbVersion,
        authoritative: true,
        migration: 'localstorage-v1',
        migratedAt: new Date().toISOString(),
        revision: 0,
        counts
      });
    };

    await done;
    const verified = await this.loadState();
    if (!verified) throw new Error('migration-marker-not-committed');
    const verifiedMeta = await this.readMetadata();
    if (verifiedMeta?.migration === 'localstorage-v1') {
      COLLECTIONS.forEach(name => {
        if (verified[name].length !== verifiedMeta.counts[name]) {
          throw new Error('migration-count-mismatch:' + name);
        }
      });
    }
    return {
      status: didMigrate ? 'migrated' : 'already-initialized',
      state: verified,
      counts: verifiedMeta?.counts || counts
    };
  }

  commitState(nextState) {
    const validated = validateState(nextState);
    const operation = this.commitQueue.then(async () => {
      const db = await this.open();
      const tx = db.transaction(['appState', 'metadata'], 'readwrite');
      const done = transactionDone(tx);
      const appStore = tx.objectStore('appState');
      const metaStore = tx.objectStore('metadata');

      const metaRequest = metaStore.get('state');
      metaRequest.onsuccess = () => {
        const previousMeta = metaRequest.result;
        COLLECTIONS.forEach(name => {
          appStore.put({ key: name, value: validated[name] });
        });
        metaStore.put({
          key: 'state',
          schemaVersion: this.dbVersion,
          authoritative: true,
          revision: (Number(previousMeta?.revision) || 0) + 1,
          updatedAt: new Date().toISOString(),
          counts: Object.fromEntries(COLLECTIONS.map(name => [name, validated[name].length]))
        });
      };
      await done;
      return { committed: true, state: clone(validated) };
    });
    this.commitQueue = operation.catch(() => undefined);
    return operation;
  }
}

export const DATA_MANAGER_SCHEMA = Object.freeze({
  database: DEFAULT_DB_NAME,
  version: DEFAULT_DB_VERSION,
  stores: Object.freeze(['appState', 'metadata']),
  collections: COLLECTIONS,
  legacyKeys: LEGACY_KEYS
});
