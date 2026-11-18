import { ParsedGcodeData, SavedModelItem } from '../types';

const DB_NAME = 'elegoo_cc2_models_library_db';
const STORE_NAME = 'saved_models';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const LOCAL_STORAGE_FALLBACK_KEY = 'elegoo_cc2_saved_models_fallback_v1';

function getFallbackModels(): SavedModelItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setFallbackModels(models: SavedModelItem[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, JSON.stringify(models));
  } catch {
    // Ignore storage quota errors
  }
}

export async function getAllSavedModels(): Promise<SavedModelItem[]> {
  try {
    const db = await openDb();
    return await new Promise<SavedModelItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const results = req.result as SavedModelItem[];
        // Sort newest first
        results.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback to localStorage
    const list = getFallbackModels();
    list.sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
    return list;
  }
}

export async function saveModelToLibrary(
  parsed: ParsedGcodeData,
  customDisplayName?: string
): Promise<SavedModelItem> {
  const is3mf =
    parsed.is3mf ||
    parsed.fileName.toLowerCase().endsWith('.3mf') ||
    (parsed.plates && parsed.plates.length > 0);

  // Check if this model already exists by filename
  const existingList = await getAllSavedModels();
  const existing = existingList.find(
    (m) => m.fileName.toLowerCase() === parsed.fileName.toLowerCase()
  );

  const modelItem: SavedModelItem = {
    id: existing?.id || `model_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fileName: parsed.fileName,
    displayName: customDisplayName || existing?.displayName || parsed.fileName.replace(/\.(gcode|gco|g|3mf)$/i, ''),
    importedAt: Date.now(),
    fileSizeBytes: parsed.fileSizeBytes || 0,
    format: is3mf ? '3mf' : 'gcode',
    thumbnailBase64: parsed.thumbnailBase64 || existing?.thumbnailBase64 || null,
    parsedData: parsed,
    platesCount: parsed.plates ? parsed.plates.length : undefined
  };

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(modelItem);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const list = getFallbackModels();
    const idx = list.findIndex((m) => m.fileName.toLowerCase() === modelItem.fileName.toLowerCase());
    if (idx >= 0) {
      list[idx] = modelItem;
    } else {
      list.unshift(modelItem);
    }
    setFallbackModels(list);
  }

  return modelItem;
}

export async function deleteModelFromLibrary(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const list = getFallbackModels().filter((m) => m.id !== id);
    setFallbackModels(list);
  }
}

export async function clearAllSavedModels(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    setFallbackModels([]);
  }
}

export async function updateModelThumbnailInLibrary(
  idOrFileName: string,
  newThumbnailBase64: string
): Promise<SavedModelItem | null> {
  const existingList = await getAllSavedModels();
  const existing = existingList.find(
    (m) => m.id === idOrFileName || m.fileName.toLowerCase() === idOrFileName.toLowerCase()
  );
  if (!existing) return null;

  existing.thumbnailBase64 = newThumbnailBase64;
  existing.parsedData.thumbnailBase64 = newThumbnailBase64;

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(existing);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const list = getFallbackModels();
    const idx = list.findIndex(
      (m) => m.id === existing.id || m.fileName.toLowerCase() === existing.fileName.toLowerCase()
    );
    if (idx >= 0) {
      list[idx] = existing;
      setFallbackModels(list);
    }
  }

  return existing;
}

