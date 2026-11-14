'use client';

import { getSupabaseClient } from '@/lib/supabase/client';
import { notifyOfflineStateChanged } from './config';
import {
  idbDelete,
  idbGetAll,
  idbPut,
  OFFLINE_STORES,
  type SyncOutboxRecord,
} from './db';
import { isBrowserOnline } from './connectivity';

/**
 * ZARKHEZ Deterministic Offline Sync Outbox (lib/offline/sync.ts)
 *
 * Zero-Regression Design:
 * - Queues failed or offline mutations cleanly in IndexedDB ('syncOutbox').
 * - Uses deterministic opIds so retries are idempotent (never duplicate rows).
 * - Preserves existing Supabase tables ('fields', 'scans', 'diary_entries') & RLS.
 * - Detects stale/missing cloud auth or timestamp conflicts honestly without data loss.
 */

export const MAX_SYNC_ATTEMPTS = 8;

export function computeNextRetryDelayMs(attempts: number): number {
  const step = Math.max(0, attempts - 1);
  return Math.min(30 * 60_000, 15_000 * Math.pow(2, step));
}

export async function enqueueSyncOperation(input: {
  entity: SyncOutboxRecord['entity'];
  action: SyncOutboxRecord['action'];
  recordId: string;
  payload: Record<string, unknown>;
  clientUpdatedAt?: string;
}): Promise<SyncOutboxRecord> {
  // Collapse opposing pending local operations for the same record before enqueueing
  if (input.action === 'delete') {
    await idbDelete(OFFLINE_STORES.SYNC_OUTBOX, `${input.entity}:upsert:${input.recordId}`).catch(() => false);
    await idbDelete(OFFLINE_STORES.SYNC_OUTBOX, `${input.entity}:create:${input.recordId}`).catch(() => false);
  } else {
    await idbDelete(OFFLINE_STORES.SYNC_OUTBOX, `${input.entity}:delete:${input.recordId}`).catch(() => false);
  }

  const opId = `${input.entity}:${input.action}:${input.recordId}`;
  const record: SyncOutboxRecord = {
    opId,
    entity: input.entity,
    action: input.action,
    payload: { ...input.payload, id: input.recordId },
    clientUpdatedAt: input.clientUpdatedAt || new Date().toISOString(),
    createdAt: Date.now(),
    attempts: 0,
    status: 'pending',
    nextRetryAt: undefined,
  };
  await idbPut(OFFLINE_STORES.SYNC_OUTBOX, record);
  return record;
}

export async function listSyncOutbox(): Promise<SyncOutboxRecord[]> {
  const items = await idbGetAll<SyncOutboxRecord>(OFFLINE_STORES.SYNC_OUTBOX);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeSyncOutboxItem(opId: string): Promise<boolean> {
  return idbDelete(OFFLINE_STORES.SYNC_OUTBOX, opId);
}

export interface SyncFlushResult {
  processed: number;
  synced: number;
  conflicts: number;
  failed: number;
  skippedReason?: string;
}

function markLocalScanCloudSynced(scanId: string): void {
  if (typeof window === 'undefined' || !scanId) return;
  try {
    const raw = localStorage.getItem('zarkhez_scans');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<{ id?: string; cloudSynced?: boolean }>;
    if (!Array.isArray(parsed)) return;
    let changed = false;
    const updated = parsed.map((row) => {
      if (row?.id === scanId && !row.cloudSynced) {
        changed = true;
        return { ...row, cloudSynced: true };
      }
      return row;
    });
    if (changed) {
      localStorage.setItem('zarkhez_scans', JSON.stringify(updated));
    }
  } catch {
    // non-fatal localStorage update
  }
}

let flushInFlight = false;

export async function flushSyncOutbox(options?: {
  forceRetry?: boolean;
}): Promise<SyncFlushResult> {
  const forceRetry = Boolean(options?.forceRetry);
  if (!isBrowserOnline()) {
    return {
      processed: 0,
      synced: 0,
      conflicts: 0,
      failed: 0,
      skippedReason: 'offline',
    };
  }
  if (flushInFlight) {
    return {
      processed: 0,
      synced: 0,
      conflicts: 0,
      failed: 0,
      skippedReason: 'already_running',
    };
  }

  flushInFlight = true;
  let synced = 0;
  let conflicts = 0;
  let failed = 0;
  let processed = 0;

  try {
    const now = Date.now();
    const outbox = await listSyncOutbox();
    const pending = outbox.filter((item) => {
      if (item.status === 'pending') return true;
      if (item.status !== 'failed') return false;
      if (forceRetry) return true;
      if ((item.attempts || 0) >= MAX_SYNC_ATTEMPTS) return false;
      return !item.nextRetryAt || now >= item.nextRetryAt;
    });
    if (pending.length === 0) {
      return { processed: 0, synced: 0, conflicts: 0, failed: 0 };
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return {
        processed: 0,
        synced: 0,
        conflicts: 0,
        failed: 0,
        skippedReason: 'supabase_unconfigured',
      };
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      return {
        processed: 0,
        synced: 0,
        conflicts: 0,
        failed: 0,
        skippedReason: 'unauthenticated_guest',
      };
    }

    const userId = session.user.id;

    for (const item of pending) {
      if (!isBrowserOnline()) break;

      processed++;
      const nextAttemptCount = (item.attempts || 0) + 1;
      await idbPut<SyncOutboxRecord>(OFFLINE_STORES.SYNC_OUTBOX, {
        ...item,
        status: 'syncing',
        attempts: nextAttemptCount,
      });

      try {
        if (item.entity === 'field' && item.action === 'upsert') {
          const id = String(item.payload.id || '');
          const { data: existing } = await supabase
            .from('fields')
            .select('id, created_at')
            .eq('id', id)
            .eq('user_id', userId)
            .maybeSingle();

          if (
            existing?.created_at &&
            new Date(existing.created_at).getTime() >
              new Date(item.clientUpdatedAt).getTime() + 5000
          ) {
            conflicts++;
            await idbPut<SyncOutboxRecord>(OFFLINE_STORES.SYNC_OUTBOX, {
              ...item,
              attempts: nextAttemptCount,
              status: 'conflict',
              conflictReason:
                'Cloud already holds a newer field record timestamp than this local edit.',
            });
            continue;
          }

          const { error } = await supabase.from('fields').upsert({
            id,
            user_id: userId,
            name: String(item.payload.name || 'Field'),
            crop: String(item.payload.crop || 'wheat'),
            area_acres: Number(item.payload.area_acres || 1),
            soil_type: String(item.payload.soil_type || 'medium'),
            sowing_date: String(
              item.payload.sowing_date || new Date().toISOString().slice(0, 10)
            ),
          });
          if (error) throw new Error(error.message);
        } else if (item.entity === 'field' && item.action === 'delete') {
          const { error } = await supabase
            .from('fields')
            .delete()
            .eq('id', String(item.payload.id || ''))
            .eq('user_id', userId);
          if (error) throw new Error(error.message);
        } else if (item.entity === 'diary' && item.action === 'create') {
          const { error } = await supabase.from('diary_entries').upsert({
            id: String(item.payload.id || ''),
            user_id: userId,
            field_id: item.payload.field_id ? String(item.payload.field_id) : null,
            kind: String(item.payload.kind || 'note'),
            category: String(item.payload.category || 'General'),
            amount: Number(item.payload.amount || 0),
            note: String(item.payload.note || ''),
            entry_date: String(
              item.payload.entry_date || new Date().toISOString().slice(0, 10)
            ),
          });
          if (error) throw new Error(error.message);
        } else if (item.entity === 'diary' && item.action === 'delete') {
          const { error } = await supabase
            .from('diary_entries')
            .delete()
            .eq('id', String(item.payload.id || ''))
            .eq('user_id', userId);
          if (error) throw new Error(error.message);
        } else if (item.entity === 'scan' && item.action === 'create') {
          const recordId = String(item.payload.id || Date.now());
          const imagePath = String(
            item.payload.image_path || `${userId}/${recordId}.jpg`
          );
          const { data: existingScan } = await supabase
            .from('scans')
            .select('id')
            .eq('user_id', userId)
            .eq('image_path', imagePath)
            .maybeSingle();

          if (!existingScan) {
            const { error } = await supabase.from('scans').insert({
              user_id: userId,
              field_id: item.payload.field_id ? String(item.payload.field_id) : null,
              image_path: imagePath,
              label: String(item.payload.label || 'Offline scan'),
              confidence: Number(item.payload.confidence || 0),
              advice: item.payload.advice ?? {},
            });
            if (error) throw new Error(error.message);
          }
          markLocalScanCloudSynced(recordId);
        }

        synced++;
        await idbDelete(OFFLINE_STORES.SYNC_OUTBOX, item.opId);
      } catch (err) {
        if (!isBrowserOnline()) {
          // Network dropped mid-flush: keep pending without penalizing retry count
          await idbPut<SyncOutboxRecord>(OFFLINE_STORES.SYNC_OUTBOX, {
            ...item,
            status: 'pending',
          });
          break;
        }
        failed++;
        await idbPut<SyncOutboxRecord>(OFFLINE_STORES.SYNC_OUTBOX, {
          ...item,
          attempts: nextAttemptCount,
          nextRetryAt: Date.now() + computeNextRetryDelayMs(nextAttemptCount),
          status: 'failed',
          lastError: err instanceof Error ? err.message : 'Sync failed',
        });
      }
    }

    notifyOfflineStateChanged();
    return { processed, synced, conflicts, failed };
  } finally {
    flushInFlight = false;
  }
}

let autoSyncBound = false;

export function bindForegroundSyncListeners(): void {
  if (autoSyncBound || typeof window === 'undefined') return;
  autoSyncBound = true;

  window.addEventListener('online', () => {
    void flushSyncOutbox();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isBrowserOnline()) {
      void flushSyncOutbox();
    }
  });
}
