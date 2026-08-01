/**
 * User-added battle maps stored in IndexedDB (survives reload in browser + Electron).
 */

const DB_NAME = "dungeon-stage-custom-maps-v1";
const DB_VERSION = 1;
const STORE_NAME = "maps";
export const CUSTOM_MAPS_SYNC_KEY = "dungeon-stage-custom-maps-sync";
export const CUSTOM_MAPS_CATEGORY_ID = "custom-maps";

const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const ACCEPTED_EXTENSIONS = /\.(png|jpe?g)$/i;

const neutralStageFxOverrides = {
  bloomEnabled: false,
  groundFogEnabled: false,
  dustMotesEnabled: false,
  embersEnabled: false,
  exposure: 1,
  saturation: 1,
  contrast: 1,
};

/** @type {Array<object>} */
let customMapEntries = [];
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

function buildMapEntryFromRecord(record) {
  const objectUrl = URL.createObjectURL(record.blob);
  return {
    id: record.id,
    name: record.name,
    file: objectUrl,
    thumb: objectUrl,
    cacheKey: record.id,
    custom: true,
    effects: { water: 0, wind: 0, fire: 0, fog: 0, snow: 0 },
    stageFxOverrides: neutralStageFxOverrides,
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

async function deleteRecord(mapId) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(mapId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("IndexedDB delete failed"));
  });
}

function sanitizeMapName(fileName) {
  const trimmed = String(fileName || "").trim();
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "").trim();
  const cleaned = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Custom map";
}

export function isAcceptedCustomMapFile(file) {
  if (!file) return false;
  if (ACCEPTED_MIME_TYPES.has(file.type)) return true;
  return ACCEPTED_EXTENSIONS.test(file.name || "");
}

export function isCustomBattleMapId(mapId) {
  return String(mapId || "").startsWith("custom-");
}

export function getCustomBattleMapEntries() {
  return customMapEntries;
}

export function getCustomMapsCategory() {
  return {
    id: CUSTOM_MAPS_CATEGORY_ID,
    name: "Custom Maps",
    maps: customMapEntries,
    isCustomCategory: true,
  };
}

export async function initCustomBattleMaps(forceReload = false) {
  if (loadPromise && !forceReload) {
    return loadPromise;
  }

  loadPromise = (async () => {
    for (const entry of customMapEntries) {
      revokeEntryUrls(entry);
    }

    const records = await readAllRecords();
    records.sort((left, right) => (left.addedAt || 0) - (right.addedAt || 0));
    customMapEntries = records.map(buildMapEntryFromRecord);
  })();

  return loadPromise;
}

export function notifyCustomMapsChanged() {
  try {
    localStorage.setItem(CUSTOM_MAPS_SYNC_KEY, String(Date.now()));
  } catch {
    // ignore quota / privacy mode
  }
}

export async function addCustomBattleMapFromFile(file) {
  if (!isAcceptedCustomMapFile(file)) {
    throw new Error("Only PNG and JPEG map images are supported.");
  }

  const mapId = `custom-${crypto.randomUUID()}`;
  const record = {
    id: mapId,
    name: sanitizeMapName(file.name),
    mimeType: file.type || "image/png",
    blob: file,
    addedAt: Date.now(),
  };

  await writeRecord(record);
  await initCustomBattleMaps(true);
  notifyCustomMapsChanged();

  return customMapEntries.find((entry) => entry.id === mapId) || null;
}

export async function removeCustomBattleMap(mapId) {
  if (!isCustomBattleMapId(mapId)) {
    return false;
  }

  const existingEntry = customMapEntries.find((entry) => entry.id === mapId);
  revokeEntryUrls(existingEntry);
  await deleteRecord(mapId);
  await initCustomBattleMaps(true);
  notifyCustomMapsChanged();
  return true;
}
