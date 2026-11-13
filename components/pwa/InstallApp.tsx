'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  MoreVertical,
  PlusSquare,
  Share,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { usePWA, type InstallPlatform } from './PWAProvider';

/**
 * Shared install action: uses the native prompt where the browser supports it
 * (Android Chrome / Edge / Samsung Internet, desktop Chromium), otherwise opens
 * step-by-step instructions (iOS Safari, Firefox, in-app browsers...).
 */
export function useInstallAction() {
  const { canPromptInstall, promptInstall } = usePWA();
  const [busy, setBusy] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const install = useCallback(async () => {
    if (canPromptInstall) {
      setBusy(true);
      const outcome = await promptInstall();
      setBusy(false);
      if (outcome === 'unavailable') setShowInstructions(true);
      return outcome;
    }
    setShowInstructions(true);
    return 'unavailable' as const;
  }, [canPromptInstall, promptInstall]);

  return {
    install,
    busy,
    showInstructions,
    closeInstructions: () => setShowInstructions(false),
  };
}

interface Step {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}

function stepsFor(platform: InstallPlatform, t: (key: string) => string): Step[] {
  if (platform === 'ios-safari' || platform === 'ios-other') {
    return [
      { icon: Share, text: t('iosStep1') },
      { icon: PlusSquare, text: t('iosStep2') },
      { icon: CheckCircle2, text: t('iosStep3') },
    ];
  }
  if (platform === 'desktop') {
    return [
      { icon: Download, text: t('desktopStep1') },
      { icon: CheckCircle2, text: t('desktopStep2') },
    ];
  }
  return [
    { icon: MoreVertical, text: t('androidStep1') },
    { icon: Download, text: t('androidStep2') },
    { icon: CheckCircle2, text: t('androidStep3') },
  ];
}

export function InstallInstructionsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('pwa');
  const { platform } = usePWA();
  const steps = stepsFor(platform, t);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="zk-install-sheet"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="zk-install-sheet-title"
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] rounded-t-[28px] bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl space-y-4 text-start"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-[14px] overflow-hidden border border-emerald-400/40 shadow-md flex-shrink-0 bg-[#062409]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/icon-192.png" alt="" width={48} height={48} className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="zk-install-sheet-title" className="font-black text-base text-ink">
                  {t('howToInstall')}
                </h3>
                <p className="text-xs text-ink/60 truncate" dir="ltr">ZARKHEZ</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('close')}
                className="w-10 h-10 rounded-full bg-canvas flex items-center justify-center text-ink/70 active:scale-95"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {platform === 'in-app' && (
              <div className="flex gap-2 rounded-xl bg-alert-amber/10 border border-alert-amber/40 p-3 text-xs font-bold text-ink/85">
                <AlertTriangle className="w-4 h-4 text-alert-amber flex-shrink-0 mt-0.5" />
                <span>{t('inAppBrowser')}</span>
              </div>
            )}
            {platform === 'ios-other' && (
              <div className="flex gap-2 rounded-xl bg-alert-amber/10 border border-alert-amber/40 p-3 text-xs font-bold text-ink/85">
                <AlertTriangle className="w-4 h-4 text-alert-amber flex-shrink-0 mt-0.5" />
                <span>{t('iosOtherBrowser')}</span>
              </div>
            )}

            <ol className="space-y-2.5">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li
                    key={index}
                    className="flex items-center gap-3 rounded-2xl bg-canvas border border-olive/10 p-3"
                  >
                    <span className="w-7 h-7 rounded-full bg-[#062409] text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                      {index + 1}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-ink/85">{step.text}</span>
                    <Icon className="w-5 h-5 text-olive flex-shrink-0" />
                  </li>
                );
              })}
            </ol>

            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[48px] rounded-xl bg-[#062409] text-white font-black text-sm active:scale-[0.98] transition-transform"
            >
              {t('close')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Persistent "Install App" entry point (used on the Profile screen). */
export function InstallAppCard() {
  const t = useTranslations('pwa');
  const { ready, isInstalled } = usePWA();
  const { install, busy, showInstructions, closeInstructions } = useInstallAction();

  if (!ready) return null;

  if (isInstalled) {
    return (
      <section className="bg-white rounded-2xl p-4 shadow-soft border border-olive/15 flex items-center gap-3">
        <div className="w-11 h-11 rounded-[13px] overflow-hidden border border-emerald-400/40 flex-shrink-0 bg-[#062409]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={44} height={44} className="w-full h-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-olive-dark">
            <CheckCircle2 className="w-4 h-4 text-olive-fresh" />
            <span>{t('installedTitle')}</span>
          </p>
          <p className="text-[11px] text-ink/60">{t('installedSubtitle')}</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-2xl p-4 shadow-soft border border-emerald-400/25 bg-gradient-to-br from-[#062409] via-[#0b3a12] to-[#062409] text-white space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-[14px] overflow-hidden border border-emerald-400/40 shadow-[0_0_24px_rgba(95,165,46,0.35)] flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={48} height={48} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-sm sm:text-base text-white">{t('installTitle')}</h3>
            <p className="text-[11px] text-cream/80">{t('installSubtitle')}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { icon: Zap, label: t('benefitFast') },
            { icon: WifiOff, label: t('benefitOffline') },
            { icon: Camera, label: t('benefitCamera') },
          ].map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/15 px-2.5 py-0.5 text-[11px] font-bold text-cream"
            >
              <Icon className="w-3 h-3 text-emerald-300" />
              {label}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          className="w-full min-h-[50px] rounded-xl bg-olive-fresh hover:bg-olive text-white font-black text-sm shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-70"
        >
          <Download className="w-4 h-4" />
          <span>{busy ? t('installing') : t('installButton')}</span>
        </button>
      </section>

      <InstallInstructionsSheet open={showInstructions} onClose={closeInstructions} />
    </>
  );
}

/** Compact "Install App" pill for the Welcome footer; hides once installed. */
export function InstallAppPill() {
  const t = useTranslations('pwa');
  const { ready, isInstalled } = usePWA();
  const { install, busy, showInstructions, closeInstructions } = useInstallAction();

  if (!ready || isInstalled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-emerald-400/35 text-xs font-bold text-emerald-200 transition-all active:scale-95 disabled:opacity-70"
      >
        <Download className="w-3.5 h-3.5 text-emerald-300" />
        <span>{busy ? t('installing') : t('installButton')}</span>
      </button>

      <InstallInstructionsSheet open={showInstructions} onClose={closeInstructions} />
    </>
  );
}
