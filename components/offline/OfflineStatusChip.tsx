'use client';

import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff, HardDriveDownload, RefreshCw } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useOfflineConnectivity } from '@/lib/offline/connectivity';
import { OFFLINE_STATE_CHANGED_EVENT } from '@/lib/offline/config';
import { idbGetAll, OFFLINE_STORES, type SyncOutboxRecord, type OfflineModelRecord } from '@/lib/offline/db';

interface OfflineStatusChipProps {
  compact?: boolean;
  variant?: 'glass' | 'surface';
}

export function OfflineStatusChip({
  compact = false,
  variant = 'surface',
}: OfflineStatusChipProps) {
  const locale = useLocale() as 'en' | 'ur';
  const { isOnline } = useOfflineConnectivity();
  const [pendingSync, setPendingSync] = useState(0);
  const [hasModel, setHasModel] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [outbox, models] = await Promise.all([
          idbGetAll<SyncOutboxRecord>(OFFLINE_STORES.SYNC_OUTBOX),
          idbGetAll<OfflineModelRecord>(OFFLINE_STORES.MODELS),
        ]);
        if (!active) return;
        setPendingSync(
          outbox.filter((item) => item.status === 'pending' || item.status === 'failed').length
        );
        setHasModel(models.some((m) => m.status === 'installed'));
      } catch {
        // ignore if IndexedDB blocked
      }
    };
    refresh();
    const onOfflineStateChanged = () => {
      void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    window.addEventListener(OFFLINE_STATE_CHANGED_EVENT, onOfflineStateChanged);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Low-frequency fallback timer only (instant updates flow via OFFLINE_STATE_CHANGED_EVENT)
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(OFFLINE_STATE_CHANGED_EVENT, onOfflineStateChanged);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isOnline]);

  const baseClasses =
    variant === 'glass'
      ? isOnline
        ? 'bg-white/15 border-white/25 text-white hover:bg-white/25'
        : 'bg-alert-amber/25 border-alert-amber/60 text-white'
      : isOnline
      ? 'bg-canvas border-olive/20 text-olive-dark hover:bg-olive/10'
      : 'bg-alert-amber/15 border-alert-amber/40 text-ink';

  const label = !isOnline
    ? locale === 'ur'
      ? 'آف لائن موڈ'
      : 'Offline Ready'
    : pendingSync > 0
    ? locale === 'ur'
      ? `${pendingSync} زیر التوا`
      : `${pendingSync} to sync`
    : hasModel
    ? locale === 'ur'
      ? 'آف لائن تیار'
      : 'Offline AI Ready'
    : locale === 'ur'
    ? 'آف لائن پیک'
    : 'Offline Center';

  return (
    <Link
      href="/offline-center"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all min-h-[30px] whitespace-nowrap ${baseClasses}`}
      aria-label={
        locale === 'ur' ? 'آف لائن ڈاؤن لوڈ اور اسٹیٹس سینٹر' : 'Offline Status and Downloads'
      }
    >
      {!isOnline ? (
        <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
      ) : pendingSync > 0 ? (
        <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
      ) : hasModel ? (
        <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
      ) : (
        <HardDriveDownload className="w-3.5 h-3.5 flex-shrink-0" />
      )}
      {!compact && <span>{label}</span>}
    </Link>
  );
}
