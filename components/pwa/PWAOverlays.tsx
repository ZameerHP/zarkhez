'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Download, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';
import { usePathname } from '@/i18n/routing';
import { usePWA } from './PWAProvider';
import { InstallInstructionsSheet, useInstallAction } from './InstallApp';

const DISMISS_KEY = 'zarkhez_install_dismissed_at';
const DISMISS_DAYS = 7;
const BANNER_DELAY_MS = 5000;

// Never interrupt focused tasks (camera scanning, voice advisor) or internal tools.
const QUIET_ROUTES = ['/scan', '/assistant', '/admin', '/voice-test'];

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Floating PWA notices positioned above BottomNav (never covering header
 * back/language controls) or near the bottom on the welcome screen:
 *  1. "New version available" (update waiting)
 *  2. Offline notice / "Back online" toast
 *  3. Install banner (Android native prompt, iOS Safari "Add to Home Screen" hint)
 */
export function PWAOverlays() {
  const t = useTranslations('pwa');
  const pathname = usePathname();
  const {
    ready,
    isInstalled,
    canPromptInstall,
    platform,
    isOnline,
    updateAvailable,
    applyUpdate,
  } = usePWA();
  const { install, busy, showInstructions, closeInstructions } = useInstallAction();

  // ---- Install banner ----------------------------------------------------
  const [delayPassed, setDelayPassed] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!ready) return;
    setDismissed(dismissedRecently());
    const timer = window.setTimeout(() => setDelayPassed(true), BANNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready]);

  const quietRoute = QUIET_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  const installable = canPromptInstall || platform === 'ios-safari';
  const showInstallBanner =
    ready && delayPassed && !dismissed && !isInstalled && installable && !quietRoute && isOnline;

  const dismissBanner = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  // ---- Connectivity & Update dismissal -----------------------------------
  const [showBackOnline, setShowBackOnline] = useState(false);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!isOnline) {
      wasOffline.current = true;
      setShowBackOnline(false);
      setOfflineDismissed(false);
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setOfflineDismissed(false);
      setShowBackOnline(true);
      const timer = window.setTimeout(() => setShowBackOnline(false), 2500);
      return () => window.clearTimeout(timer);
    }
  }, [isOnline, ready]);

  if (!ready) return null;

  const isWelcomeRoute = pathname === '/' || pathname === '';
  const isNoNavRoute =
    isWelcomeRoute || pathname.startsWith('/admin') || pathname.startsWith('/voice-test');
  const isDiaryRoute = pathname === '/diary' || pathname.startsWith('/diary/');

  // Clear BottomNav (all inner screens) and the Diary "+" FAB.
  const bottomPositionClass = isNoNavRoute
    ? 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
    : isDiaryRoute
    ? 'bottom-[calc(9.5rem+env(safe-area-inset-bottom))]'
    : 'bottom-[calc(5.25rem+env(safe-area-inset-bottom))]';

  return (
    <>
      <div
        className={`fixed inset-x-0 z-[70] pointer-events-none flex justify-center px-3 ${bottomPositionClass}`}
        aria-live="polite"
      >
        <div className="w-full max-w-[450px] flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {updateAvailable && !updateDismissed && (
              <motion.div
                key="update"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-[#062409]/95 backdrop-blur-lg text-white border border-emerald-400/30 shadow-[0_12px_36px_rgba(0,0,0,0.35)] p-3"
                role="status"
              >
                <div className="w-9 h-9 rounded-xl bg-olive-fresh/20 flex items-center justify-center flex-shrink-0">
                  <RefreshCw className="w-4 h-4 text-emerald-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black leading-snug">{t('updateTitle')}</p>
                  <p className="text-[11px] text-cream/75 leading-snug">{t('updateBody')}</p>
                </div>
                <button
                  type="button"
                  onClick={applyUpdate}
                  className="min-h-[40px] px-3.5 rounded-xl bg-olive-fresh text-white text-xs font-black active:scale-95 transition-transform flex-shrink-0"
                >
                  {t('updateButton')}
                </button>
                <button
                  type="button"
                  onClick={() => setUpdateDismissed(true)}
                  aria-label={t('close')}
                  className="w-8 h-8 -me-1 rounded-full flex items-center justify-center text-white/60 hover:bg-white/10 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {!isOnline && !offlineDismissed && (
              <motion.div
                key="offline"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-ink/90 backdrop-blur-lg text-white border border-alert-amber/40 shadow-[0_12px_36px_rgba(0,0,0,0.35)] p-3"
                role="alert"
              >
                <div className="w-9 h-9 rounded-xl bg-alert-amber/20 flex items-center justify-center flex-shrink-0">
                  <WifiOff className="w-4 h-4 text-alert-amber" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black leading-snug">{t('offlineTitle')}</p>
                  <p className="text-[11px] text-white/75 leading-snug">{t('offlineBody')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOfflineDismissed(true)}
                  aria-label={t('close')}
                  className="w-8 h-8 -me-1 rounded-full flex items-center justify-center text-white/60 hover:bg-white/10 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {showBackOnline && (
              <motion.div
                key="online"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="pointer-events-auto self-center flex items-center gap-2 rounded-full bg-olive-fresh text-white shadow-lg px-4 py-1.5"
                role="status"
              >
                <Wifi className="w-4 h-4" />
                <span className="text-xs font-black">{t('backOnline')}</span>
              </motion.div>
            )}

            {showInstallBanner && (
              <motion.div
                key="install"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-white text-ink border border-olive/20 shadow-[0_12px_36px_rgba(6,36,9,0.25)] p-3"
                role="dialog"
                aria-label={t('installTitle')}
              >
                <div className="w-11 h-11 rounded-[13px] overflow-hidden border border-emerald-400/40 flex-shrink-0 bg-[#062409]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icons/icon-192.png" alt="" width={44} height={44} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black leading-snug">{t('installTitle')}</p>
                  <p className="text-[11px] text-ink/60 leading-snug line-clamp-2">{t('installSubtitle')}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const outcome = await install();
                    if (outcome === 'dismissed') dismissBanner();
                  }}
                  disabled={busy}
                  className="min-h-[40px] px-3 rounded-xl bg-[#062409] text-white text-xs font-black flex items-center gap-1.5 active:scale-95 transition-transform flex-shrink-0 disabled:opacity-70"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{busy ? t('installing') : t('installButton')}</span>
                </button>
                <button
                  type="button"
                  onClick={dismissBanner}
                  aria-label={t('notNow')}
                  className="w-8 h-8 -me-1 rounded-full flex items-center justify-center text-ink/50 hover:bg-canvas flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <InstallInstructionsSheet
        open={showInstructions}
        onClose={() => {
          closeInstructions();
          dismissBanner();
        }}
      />
    </>
  );
}
