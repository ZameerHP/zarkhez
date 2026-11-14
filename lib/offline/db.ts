'use client';

import {
  notifyOfflineStateChanged,
  OFFLINE_CACHE_NAMESPACES,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
} from './config';

/**
 * ZARKHEZ Versioned IndexedDB Store (zarkhez_offline_v2)
 *
 * Completely isolated from existing Supabase/browser localStorage persistence
 * (zarkhez_durable_db_v1) so zero existing user/auth behavior is touched.
 */

export const OFFLINE_STORES = {
  WEATHER_SNAPSHOTS: 'weatherSnapshots',
  FERTILIZER_HISTORY: 'fertilizerHistory',
  FARMING_GUIDES: 'farmingGuides',
  SCHEMES: 'schemes',
  SCAN_HISTORY: 'scanHistory',
  CHAT_HISTORY: 'chatHistory',
  SYNC_OUTBOX: 'syncOutbox',
  MODELS: 'models',
  META: 'meta',
} as const;

export type OfflineStoreName =
  (typeof OFFLINE_STORES)[keyof typeof OFFLINE_STORES];

export interface WeatherSnapshotRecord {
  locationKey: string;
  placeName: string;
  lat: number;
  lon: number;
  fetchedAt: number;
  data: unknown;
}

export interface FertilizerHistoryRecord {
  id: string;
  cropKey: string;
  cropNameEn: string;
  cropNameUr: string;
  soil: 'poor' | 'medium' | 'fertile';
  areaAcres: number;
  items: Array<{
    product: string;
    kgPerAcre: number;
    totalKg: number;
    bags50Kg: number;
  }>;
  source: string;
  assumptions: string;
  createdAt: number;
}

export interface OfflineModelRecord {
  modelId: string;
  name: string;
  kind: 'vision-onnx' | 'llm-onnx' | 'knowledge-pack';
  version: string;
  status: 'installed' | 'downloading' | 'error' | 'not_installed';
  expectedBytes: number;
  downloadedBytes: number;
  checksumSha256?: string;
  backendUsed?: string;
  updatedAt: number;
  errorMessage?: string;
}

export interface SyncOutboxRecord {
  opId: string;
  entity: 'scan' | 'field' | 'diary' | 'profile' | 'feedback';
  action: 'upsert' | 'delete' | 'create';
  payload: Record<string, unknown>;
  clientUpdatedAt: string;
  createdAt: number;
  attempts: number;
  nextRetryAt?: number;
  status: 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
  lastError?: string;
  conflictReason?: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let lastStorageQuotaExceeded = false;

export function hasOfflineStoragePressure(): boolean {
  return lastStorageQuotaExceeded;
}

function createObjectStores(db: IDBDatabase) {
  // Clean non-destructive v2 -> v3 migration: remove deprecated store if present without touching user data
  if (db.objectStoreNames.contains('mandiCache')) {
    try {
      db.deleteObjectStore('mandiCache');
    } catch {
      // ignore if already absent
    }
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.WEATHER_SNAPSHOTS)) {
    const store = db.createObjectStore(OFFLINE_STORES.WEATHER_SNAPSHOTS, {
      keyPath: 'locationKey',
    });
    store.createIndex('fetchedAt', 'fetchedAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.FERTILIZER_HISTORY)) {
    const store = db.createObjectStore(OFFLINE_STORES.FERTILIZER_HISTORY, {
      keyPath: 'id',
    });
    store.createIndex('createdAt', 'createdAt', { unique: false });
    store.createIndex('cropKey', 'cropKey', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.FARMING_GUIDES)) {
    const store = db.createObjectStore(OFFLINE_STORES.FARMING_GUIDES, {
      keyPath: 'id',
    });
    store.createIndex('cropKey', 'cropKey', { unique: false });
    store.createIndex('category', 'category', { unique: false });
    store.createIndex('updatedAt', 'updatedAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.SCHEMES)) {
    const store = db.createObjectStore(OFFLINE_STORES.SCHEMES, {
      keyPath: 'id',
    });
    store.createIndex('province', 'province', { unique: false });
    store.createIndex('status', 'status', { unique: false });
    store.createIndex('verifiedAt', 'verifiedAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.SCAN_HISTORY)) {
    const store = db.createObjectStore(OFFLINE_STORES.SCAN_HISTORY, {
      keyPath: 'id',
    });
    store.createIndex('createdAt', 'createdAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.CHAT_HISTORY)) {
    const store = db.createObjectStore(OFFLINE_STORES.CHAT_HISTORY, {
      keyPath: 'id',
    });
    store.createIndex('updatedAt', 'updatedAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.SYNC_OUTBOX)) {
    const store = db.createObjectStore(OFFLINE_STORES.SYNC_OUTBOX, {
      keyPath: 'opId',
    });
    store.createIndex('status', 'status', { unique: false });
    store.createIndex('createdAt', 'createdAt', { unique: false });
    store.createIndex('entity', 'entity', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.MODELS)) {
    const store = db.createObjectStore(OFFLINE_STORES.MODELS, {
      keyPath: 'modelId',
    });
    store.createIndex('status', 'status', { unique: false });
    store.createIndex('updatedAt', 'updatedAt', { unique: false });
  }

  if (!db.objectStoreNames.contains(OFFLINE_STORES.META)) {
    db.createObjectStore(OFFLINE_STORES.META, { keyPath: 'key' });
  }
}

export function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        try {
          createObjectStores(request.result);
        } catch {
          // ignore upgrade conflict
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
      request.onblocked = () => {
        dbPromise = null;
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

export async function idbPut<T>(
  storeName: OfflineStoreName,
  value: T
): Promise<boolean> {
  const db = await openOfflineDb();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => {
        lastStorageQuotaExceeded = false;
        if (storeName === OFFLINE_STORES.SYNC_OUTBOX || storeName === OFFLINE_STORES.MODELS) {
          notifyOfflineStateChanged();
        }
        resolve(true);
      };
      tx.onabort = () => {
        if (tx.error?.name === 'QuotaExceededError') {
          lastStorageQuotaExceeded = true;
        }
        resolve(false);
      };
      tx.onerror = () => {
        if (tx.error?.name === 'QuotaExceededError') {
          lastStorageQuotaExceeded = true;
        }
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

export async function idbPutBatch<T>(
  storeName: OfflineStoreName,
  values: T[]
): Promise<number> {
  if (values.length === 0) return 0;
  const db = await openOfflineDb();
  if (!db) return 0;
  return new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const value of values) {
        store.put(value);
      }
      tx.oncomplete = () => {
        lastStorageQuotaExceeded = false;
        resolve(values.length);
      };
      tx.onabort = () => {
        if (tx.error?.name === 'QuotaExceededError') {
          lastStorageQuotaExceeded = true;
        }
        resolve(0);
      };
      tx.onerror = () => {
        if (tx.error?.name === 'QuotaExceededError') {
          lastStorageQuotaExceeded = true;
        }
        resolve(0);
      };
    } catch {
      resolve(0);
    }
  });
}

export async function idbPruneOldest(
  storeName: OfflineStoreName,
  maxEntries: number,
  timestampField: string,
  preserveKeys: string[] = []
): Promise<number> {
  const db = await openOfflineDb();
  if (!db) return 0;
  return new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      let deleted = 0;

      req.onsuccess = () => {
        const rows = (req.result as Array<Record<string, unknown>>) || [];
        const keyPath = typeof store.keyPath === 'string' ? store.keyPath : 'id';
        const prunable = rows.filter(
          (row) => !preserveKeys.includes(String(row[keyPath] ?? ''))
        );
        if (prunable.length <= maxEntries) {
          return;
        }
        prunable.sort(
          (a, b) => Number(a[timestampField] || 0) - Number(b[timestampField] || 0)
        );
        const removeCount = prunable.length - maxEntries;
        for (let i = 0; i < removeCount; i++) {
          const key = prunable[i]?.[keyPath] as IDBValidKey | undefined;
          if (key !== undefined && key !== null) {
            store.delete(key);
            deleted++;
          }
        }
      };

      tx.oncomplete = () => resolve(deleted);
      tx.onabort = () => resolve(0);
      tx.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export async function idbGet<T>(
  storeName: OfflineStoreName,
  key: IDBValidKey
): Promise<T | null> {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbGetAll<T>(
  storeName: OfflineStoreName
): Promise<T[]> {
  const db = await openOfflineDb();
  if (!db) return [];
  return new Promise<T[]>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as T[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function idbDelete(
  storeName: OfflineStoreName,
  key: IDBValidKey
): Promise<boolean> {
  const db = await openOfflineDb();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => {
        if (storeName === OFFLINE_STORES.SYNC_OUTBOX || storeName === OFFLINE_STORES.MODELS) {
          notifyOfflineStateChanged();
        }
        resolve(true);
      };
      tx.onabort = () => resolve(false);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbClear(storeName: OfflineStoreName): Promise<boolean> {
  const db = await openOfflineDb();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve(true);
      tx.onabort = () => resolve(false);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbCount(storeName: OfflineStoreName): Promise<number> {
  const db = await openOfflineDb();
  if (!db) return 0;
  return new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(Number(req.result) || 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export interface OfflineStorageSummary {
  quotaBytes: number | null;
  usageBytes: number | null;
  modelsCacheBytes: number;
  kbCacheBytes: number;
  storeCounts: Record<OfflineStoreName, number>;
}

async function measureCacheBytes(cacheName: string): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  try {
    const exists = await caches.has(cacheName);
    if (!exists) return 0;
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    let total = 0;
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const len = Number(
        res.headers.get('x-cached-bytes') || res.headers.get('content-length') || 0
      );
      if (len > 0) {
        total += len;
      } else if (!req.url.endsWith('.wasm') && !req.url.endsWith('.onnx')) {
        // Avoid reading large multi-megabyte binaries into JS heap merely to inspect byte length
        const blob = await res.blob();
        total += blob.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function getOfflineStorageSummary(): Promise<OfflineStorageSummary> {
  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quotaBytes = typeof est.quota === 'number' ? est.quota : null;
      usageBytes = typeof est.usage === 'number' ? est.usage : null;
    }
  } catch {
    // ignore
  }

  const [headerModelBytes, kbCacheBytes, modelRecords] = await Promise.all([
    measureCacheBytes(OFFLINE_CACHE_NAMESPACES.MODELS),
    measureCacheBytes(OFFLINE_CACHE_NAMESPACES.KB_ASSETS),
    idbGetAll<OfflineModelRecord>(OFFLINE_STORES.MODELS),
  ]);

  const recordedModelBytes = modelRecords
    .filter((m) => m.status === 'installed')
    .reduce((sum, m) => sum + (m.downloadedBytes || 0), 0);
  const modelsCacheBytes = Math.max(headerModelBytes, recordedModelBytes);

  const entries = await Promise.all(
    Object.values(OFFLINE_STORES).map(async (store) => [
      store,
      await idbCount(store),
    ])
  );

  return {
    quotaBytes,
    usageBytes,
    modelsCacheBytes,
    kbCacheBytes,
    storeCounts: Object.fromEntries(entries) as Record<OfflineStoreName, number>,
  };
}

export async function clearAllOfflineCachesAndStores(): Promise<void> {
  await Promise.all(Object.values(OFFLINE_STORES).map((s) => idbClear(s)));
  if (typeof caches !== 'undefined') {
    try {
      await caches.delete(OFFLINE_CACHE_NAMESPACES.MODELS);
      await caches.delete(OFFLINE_CACHE_NAMESPACES.KB_ASSETS);
    } catch {
      // ignore
    }
  }
  notifyOfflineStateChanged();
}
