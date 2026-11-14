'use client';

import { useEffect, useState } from 'react';

export interface ConnectionSnapshot {
  isOnline: boolean;
  lastChangedAt: number;
  lastOnlineAt: number | null;
}

const listeners = new Set<(snap: ConnectionSnapshot) => void>();

let currentSnapshot: ConnectionSnapshot = {
  isOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  lastChangedAt: Date.now(),
  lastOnlineAt:
    typeof navigator === 'undefined' || navigator.onLine !== false
      ? Date.now()
      : null,
};

let bound = false;

function emitSnapshot(nextOnline: boolean) {
  if (currentSnapshot.isOnline === nextOnline) return;
  const now = Date.now();
  currentSnapshot = {
    isOnline: nextOnline,
    lastChangedAt: now,
    lastOnlineAt: nextOnline ? now : currentSnapshot.lastOnlineAt,
  };
  listeners.forEach((cb) => {
    try {
      cb(currentSnapshot);
    } catch {
      // ignore subscriber failure
    }
  });
}

function bindGlobalListeners() {
  if (bound || typeof window === 'undefined') return;
  bound = true;

  currentSnapshot = {
    isOnline: navigator.onLine !== false,
    lastChangedAt: Date.now(),
    lastOnlineAt: navigator.onLine !== false ? Date.now() : null,
  };

  window.addEventListener('online', () => {
    emitSnapshot(true);
  });
  window.addEventListener('offline', () => {
    emitSnapshot(false);
  });
}

export function getConnectionSnapshot(): ConnectionSnapshot {
  if (typeof navigator !== 'undefined') {
    const navOnline = navigator.onLine !== false;
    if (navOnline !== currentSnapshot.isOnline) {
      currentSnapshot = {
        isOnline: navOnline,
        lastChangedAt: Date.now(),
        lastOnlineAt: navOnline ? Date.now() : currentSnapshot.lastOnlineAt,
      };
    }
  }
  return currentSnapshot;
}

/**
 * Reports whether an actual request should use online paths.
 * Strictly returns true whenever navigator indicates connectivity so online mode is never bypassed.
 */
export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function subscribeConnectionState(
  cb: (snap: ConnectionSnapshot) => void
): () => void {
  bindGlobalListeners();
  listeners.add(cb);
  cb(getConnectionSnapshot());
  return () => {
    listeners.delete(cb);
  };
}

export function useOfflineConnectivity(): ConnectionSnapshot {
  const [snap, setSnap] = useState<ConnectionSnapshot>(() => getConnectionSnapshot());

  useEffect(() => {
    return subscribeConnectionState((next) => {
      setSnap(next);
    });
  }, []);

  return snap;
}
