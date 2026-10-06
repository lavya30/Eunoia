'use client';

const DATABASE_NAME = 'eunoia:offline-v1';
const STORE_NAME = 'room-documents';
const DATABASE_VERSION = 1;

type StoredRoomDocument = {
  roomId: string;
  update: ArrayBufferLike;
  updatedAt: number;
};

function canUseIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'roomId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function copyUpdate(update: unknown): Uint8Array | null {
  let view: Uint8Array;
  try {
    if (ArrayBuffer.isView(update)) {
      view = new Uint8Array(
        update.buffer,
        update.byteOffset,
        update.byteLength,
      );
    } else if (update instanceof ArrayBuffer) {
      view = new Uint8Array(update);
    } else {
      return null;
    }
  } catch {
    return null;
  }
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

/** Load the last compact Yjs snapshot for a room, if IndexedDB is available. */
export async function loadOfflineSnapshot(
  roomId: string,
): Promise<Uint8Array | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    let result: Uint8Array | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(result);
    };
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(roomId);
      request.onsuccess = () => {
        const stored = request.result as StoredRoomDocument | undefined;
        if (!stored?.update) return;
        result = copyUpdate(stored.update);
      };
      transaction.oncomplete = finish;
      transaction.onerror = finish;
      transaction.onabort = finish;
    } catch {
      finish();
    }
  });
}

/** Replace the room's local snapshot with a compact Yjs state update. */
export async function saveOfflineSnapshot(
  roomId: string,
  update: ArrayBufferLike | ArrayBufferView,
): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  const copied = copyUpdate(update);
  if (!copied) {
    database.close();
    return false;
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (saved: boolean) => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(saved);
    };
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        roomId,
        update: copied.buffer,
        updatedAt: Date.now(),
      } satisfies StoredRoomDocument);
      transaction.oncomplete = () => finish(true);
      transaction.onerror = () => finish(false);
      transaction.onabort = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

export function offlineStorageAvailable(): boolean {
  return canUseIndexedDb();
}
