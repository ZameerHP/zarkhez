'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';

/**
 * ZARKHEZ PWA runtime
 * - Registers the versioned service worker (production only).
 * - Captures `beforeinstallprompt` (also captured pre-hydration by the inline
 *   head script in app/[locale]/layout.tsx so early events are never lost).
 * - Detects installed / standalone state and hides install UI after install.
 * - Tracks online/offline state and "new version waiting" state.
 * - Dismisses the standalone launch splash once the app has hydrated.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

declare global {
  interface Window {
    __zkInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export type InstallPlatform =
  | 'ios-safari'
  | 'ios-other'
  | 'android'
  | 'in-app'
  | 'desktop'
  | 'other';

type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface PWAContextValue {
  /** True once mounted on the client (avoids SSR/hydration mismatches). */
  ready: boolean;
  isStandalone: boolean;
  isInstalled: boolean;
  /** Native install prompt is available (Chrome / Edge / Samsung Internet on Android & desktop). */
  canPromptInstall: boolean;
  platform: InstallPlatform;
  isOnline: boolean;
  updateAvailable: boolean;
  promptInstall: () => Promise<InstallOutcome>;
  applyUpdate: () => void;
}

const INSTALLED_FLAG = 'zarkhez_pwa_installed';

const PWAContext = createContext<PWAContextValue | null>(null);

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = (q: string) => window.matchMedia?.(q).matches ?? false;
  return (
    mq('(display-mode: standalone)') ||
    mq('(display-mode: fullscreen)') ||
    mq('(display-mode: minimal-ui)') ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

function detectPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Snapchat|; wv\)/i.test(ua);
  if (inApp) return 'in-app';
  if (isIOS) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop';
  return 'other';
}

function readInstalledFlag(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeInstalledFlag(value: boolean) {
  try {
    if (value) window.localStorage.setItem(INSTALLED_FLAG, '1');
    else window.localStorage.removeItem(INSTALLED_FLAG);
  } catch {
    /* storage unavailable (private mode) */
  }
}

const SW_ENABLED =
  process.env.NODE_ENV === 'production' ||
  process.env.NEXT_PUBLIC_ENABLE_SW_IN_DEV === 'true';

export function PWAProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installedFlag, setInstalledFlag] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform>('other');
  const [isOnline, setIsOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const updateRequested = useRef(false);
  const pathname = usePathname();

  // --- Environment, install prompt & connectivity -------------------------
  useEffect(() => {
    setReady(true);
    setPlatform(detectPlatform());
    setIsOnline(typeof navigator.onLine === 'boolean' ? navigator.onLine : true);
    import('@/lib/offline/sync')
      .then(({ bindForegroundSyncListeners }) => bindForegroundSyncListeners())
      .catch(() => undefined);

    const standalone = detectStandalone();
    setIsStandalone(standalone);
    if (standalone) writeInstalledFlag(true);
    setInstalledFlag(standalone || readInstalledFlag());

    // Pick up an event captured before React hydrated.
    if (window.__zkInstallPrompt) setDeferredPrompt(window.__zkInstallPrompt);

    const onPromptAvailable = (event: Event) => {
      event.preventDefault?.();
      const promptEvent =
        (event.type === 'beforeinstallprompt'
          ? (event as BeforeInstallPromptEvent)
          : window.__zkInstallPrompt) || null;
      if (!promptEvent) return;
      window.__zkInstallPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
      // The browser only offers the prompt when the app is NOT installed,
      // so a stale "installed" flag (e.g. after uninstall) is cleared here.
      writeInstalledFlag(false);
      setInstalledFlag(false);
    };

    const onInstalled = () => {
      window.__zkInstallPrompt = null;
      setDeferredPrompt(null);
      writeInstalledFlag(true);
      setInstalledFlag(true);
    };

    const displayMq = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => setIsStandalone(detectStandalone());
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', onPromptAvailable);
    window.addEventListener('zk:installprompt', onPromptAvailable);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('zk:appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    displayMq?.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPromptAvailable);
      window.removeEventListener('zk:installprompt', onPromptAvailable);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('zk:appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      displayMq?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  // --- Launch splash (standalone only) ------------------------------------
  useEffect(() => {
    const html = document.documentElement;
    if (html.getAttribute('data-zk-splash') !== 'show') return;
    const fade = window.setTimeout(() => html.setAttribute('data-zk-splash', 'hide'), 450);
    const done = window.setTimeout(() => html.setAttribute('data-zk-splash', 'done'), 1000);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, []);

  // --- Service worker registration & updates ------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    if (!SW_ENABLED) {
      // Development: make sure no stale worker serves old dev bundles.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()))
        .catch(() => undefined);
      if ('caches' in window) {
        caches
          .keys()
          .then((keys) =>
            keys
              .filter(
                (k) => k.startsWith('zarkhez-') && !k.startsWith('zarkhez-offline-')
              )
              .forEach((k) => caches.delete(k))
          )
          .catch(() => undefined);
      }
      return;
    }

    let registration: ServiceWorkerRegistration | null = null;
    let disposed = false;
    let lastUpdateCheck = 0;
    const version = encodeURIComponent(process.env.NEXT_PUBLIC_APP_BUILD_VERSION || 'v2');

    const trackInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        // "installed" while another worker controls the page => an update is waiting.
        if (worker.state === 'installed' && navigator.serviceWorker.controller && !disposed) {
          setWaitingWorker(worker);
        }
      });
    };

    const checkForUpdate = () => {
      const now = Date.now();
      if (!registration || now - lastUpdateCheck < 60_000) return;
      lastUpdateCheck = now;
      registration.update().catch(() => undefined);
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register(`/sw.js?v=${version}`, {
          scope: '/',
          updateViaCache: 'none',
        });
        if (disposed) return;
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }
        trackInstalling(registration.installing);
        registration.addEventListener('updatefound', () =>
          trackInstalling(registration?.installing ?? null)
        );
      } catch {
        // Registration failures must never break the app (e.g. unsupported/private mode).
      }
    };

    const onControllerChange = () => {
      // Only reload when THIS tab asked for the update; the very first install
      // (clients.claim) and updates triggered from other tabs never interrupt the user.
      if (!updateRequested.current) return;
      updateRequested.current = false;
      window.location.reload();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(checkForUpdate, 60 * 60 * 1000);

    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('load', register);
      window.clearInterval(interval);
    };
  }, []);

  // --- Pre-warm static app-shell HTML for offline <Link> navigation -------
  useEffect(() => {
    if (!ready || !isOnline || !SW_ENABLED) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const locale = pathname?.startsWith('/en')
      ? 'en'
      : pathname?.startsWith('/ur')
      ? 'ur'
      : document.documentElement.lang === 'ur'
      ? 'ur'
      : 'en';
    const isAuth = document.cookie.includes('zarkhez_auth=1');
    const version = process.env.NEXT_PUBLIC_APP_BUILD_VERSION || 'v2';
    const warmKey = `${version}:${locale}:${isAuth ? '1' : '0'}`;

    try {
      if (window.sessionStorage.getItem('zarkhez_shell_warmed') === warmKey) return;
    } catch {
      /* ignore storage restrictions */
    }

    const urls = isAuth
      ? [
          `/${locale}/home`,
          `/${locale}/weather`,
          `/${locale}/scan`,
          `/${locale}/assistant`,
          `/${locale}/diary`,
          `/${locale}/profile`,
          `/${locale}/tools/calendar`,
          `/${locale}/tools/fertilizer`,
          `/${locale}/schemes`,
          `/${locale}/offline-center`,
        ]
      : [`/${locale}`, `/${locale}/schemes`, `/${locale}/offline-center`];

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      navigator.serviceWorker.ready
        .then((reg) => {
          if (cancelled || !reg.active) return;
          reg.active.postMessage({ type: 'WARM_SHELL', urls });
          try {
            window.sessionStorage.setItem('zarkhez_shell_warmed', warmKey);
          } catch {
            /* ignore */
          }
        })
        .catch(() => undefined);
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, isOnline, pathname]);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const promptEvent = deferredPrompt || window.__zkInstallPrompt || null;
    if (!promptEvent) return 'unavailable';
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      // A prompt event can only be used once.
      window.__zkInstallPrompt = null;
      setDeferredPrompt(null);
      if (choice.outcome === 'accepted') {
        writeInstalledFlag(true);
        setInstalledFlag(true);
      }
      return choice.outcome;
    } catch {
      window.__zkInstallPrompt = null;
      setDeferredPrompt(null);
      return 'unavailable';
    }
  }, [deferredPrompt]);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) {
      window.location.reload();
      return;
    }
    updateRequested.current = true;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    // Safety net: if controllerchange never fires, reload anyway.
    window.setTimeout(() => {
      if (updateRequested.current) window.location.reload();
    }, 4000);
  }, [waitingWorker]);

  const value = useMemo<PWAContextValue>(
    () => ({
      ready,
      isStandalone,
      isInstalled: isStandalone || installedFlag,
      canPromptInstall: Boolean(deferredPrompt) && !isStandalone,
      platform,
      isOnline,
      updateAvailable: Boolean(waitingWorker),
      promptInstall,
      applyUpdate,
    }),
    [
      ready,
      isStandalone,
      installedFlag,
      deferredPrompt,
      platform,
      isOnline,
      waitingWorker,
      promptInstall,
      applyUpdate,
    ]
  );

  return <PWAContext.Provider value={value}>{children}</PWAContext.Provider>;
}

export function usePWA(): PWAContextValue {
  const ctx = useContext(PWAContext);
  if (!ctx) {
    throw new Error('usePWA must be used inside <PWAProvider>');
  }
  return ctx;
}
