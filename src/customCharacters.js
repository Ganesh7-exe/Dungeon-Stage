/**
 * User-added stage creatures stored in IndexedDB (survives reload in browser + Electron).
 */

const DB_NAME = "dungeon-stage-custom-characters-v1";
const DB_VERSION = 1;
const STORE_NAME = "characters";
export const CUSTOM_CHARACTERS_SYNC_KEY = "dungeon-stage-custom-characters-sync";
export const CUSTOM_CHARACTERS_CATEGORY_ID = "custom-characters";

const ACCEPTED_MIME_TYPES = new Set(["model/gltf-binary"]);
const ACCEPTED_EXTENSIONS = /\.glb$/i;

/** @type {Array<object>} */
let customCharacterEntries = [];
let databasePromise = null;
let loadPromise = null;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });

  return databasePromise;
}

function revokeEntryUrls(entry) {
  if (entry?.file?.startsWith("blob:")) {
    URL.revokeObjectURL(entry.file);
  }
}

function buildCharacterEntryFromRecord(record) {
  const objectUrl = URL.createObjectURL(record.blob);
  return {
    id: record.id,
    name: record.name,
    file: objectUrl,
    custom: true,
    scale: 1,
    y: 0,
  };
}

async function readAllRecords() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
  });
}

async function writeRecord(record) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("IndexedDB write failed"));
  });
}

async function deleteRecord(characterId) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(characterId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("IndexedDB delete failed"));
  });
}

function sanitizeCharacterName(fileName) {
  const trimmed = String(fileName || "").trim();
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "").trim();
  const cleaned = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Custom character";
}

export function isAcceptedCustomCharacterFile(file) {
  if (!file) return false;
  if (ACCEPTED_MIME_TYPES.has(file.type)) return true;
  return ACCEPTED_EXTENSIONS.test(file.name || "");
}

export function isCustomCharacterId(characterId) {
  return String(characterId || "").startsWith("custom-");
}

export function getCustomCharacterEntries() {
  return customCharacterEntries;
}

export function getCustomCharactersCategory() {
  return {
    id: CUSTOM_CHARACTERS_CATEGORY_ID,
    name: "Custom Characters",
    characters: customCharacterEntries,
    isCustomCategory: true,
  };
}

export async function initCustomCharacters(forceReload = false) {
  if (loadPromise && !forceReload) {
    return loadPromise;
  }

  loadPromise = (async () => {
    for (const entry of customCharacterEntries) {
      revokeEntryUrls(entry);
    }

    const records = await readAllRecords();
    records.sort((left, right) => (left.addedAt || 0) - (right.addedAt || 0));
    customCharacterEntries = records.map(buildCharacterEntryFromRecord);
  })();

  return loadPromise;
}

export function notifyCustomCharactersChanged() {
  try {
    localStorage.setItem(CUSTOM_CHARACTERS_SYNC_KEY, String(Date.now()));
  } catch {
    // ignore quota / privacy mode
  }
}

export async function addCustomCharacterFromFile(file) {
  if (!isAcceptedCustomCharacterFile(file)) {
    throw new Error("Only GLB character models are supported.");
  }

  const characterId = `custom-${crypto.randomUUID()}`;
  const record = {
    id: characterId,
    name: sanitizeCharacterName(file.name),
    mimeType: file.type || "model/gltf-binary",
    blob: file,
    addedAt: Date.now(),
  };

  await writeRecord(record);
  await initCustomCharacters(true);
  notifyCustomCharactersChanged();

  return customCharacterEntries.find((entry) => entry.id === characterId) || null;
}

export async function removeCustomCharacter(characterId) {
  if (!isCustomCharacterId(characterId)) {
    return false;
  }

  const existingEntry = customCharacterEntries.find((entry) => entry.id === characterId);
  revokeEntryUrls(existingEntry);
  await deleteRecord(characterId);
  await initCustomCharacters(true);
  notifyCustomCharactersChanged();
  return true;
}
