'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import {
  getSavedProfile,
  FarmerProfile,
  restorePersistentSession,
  syncSupabaseAuthSession,
} from '@/lib/supabase/client';

export function isUserAuthenticated(profile?: FarmerProfile): boolean {
  const p = profile || (typeof window !== 'undefined' ? getSavedProfile() : null);
  if (!p) return false;
  return Boolean(
    p.isAuthenticated &&
    p.email &&
    p.email.includes('@') &&
    p.authProvider !== 'anonymous' &&
    p.authProvider !== 'none'
  );
}

/**
 * Universal Authentication & Identity Barrier (AuthGuard)
 * Strictly guarantees that NO user can EVER view or access the inner interface
 * (Home, Scan, Advisor, Diary, Profile, Weather, Crop Detail, Tools)
 * without a valid Login or Sign Up session.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  // Public welcome / login / signup route check
  const isPublicWelcomeRoute =
    pathname === '/' ||
    pathname === `/${locale}` ||
    pathname === '' ||
    pathname === `/${locale}/`;

  const [authorized, setAuthorized] = useState<boolean>(() => {
    if (isPublicWelcomeRoute) return true;
    if (typeof window === 'undefined') return false;
    return isUserAuthenticated();
  });

  useEffect(() => {
    let active = true;

    if (isPublicWelcomeRoute) {
      setAuthorized(true);
      return () => {
        active = false;
      };
    }

    const verifySession = async () => {
      const localProfile = getSavedProfile();
      if (isUserAuthenticated(localProfile)) {
        if (typeof document !== 'undefined') {
          document.cookie = 'zarkhez_auth=1; path=/; max-age=31536000; SameSite=Lax';
        }
        if (active) setAuthorized(true);
        return;
      }

      // Recover session seamlessly from IndexedDB durable mirror or Supabase OAuth before logging out
      const restored = await restorePersistentSession();
      if (restored && isUserAuthenticated(restored)) {
        if (typeof document !== 'undefined') {
          document.cookie = 'zarkhez_auth=1; path=/; max-age=31536000; SameSite=Lax';
        }
        if (active) setAuthorized(true);
        return;
      }

      const synced = await syncSupabaseAuthSession();
      if (synced && isUserAuthenticated(synced)) {
        if (typeof document !== 'undefined') {
          document.cookie = 'zarkhez_auth=1; path=/; max-age=31536000; SameSite=Lax';
        }
        if (active) setAuthorized(true);
        return;
      }

      if (typeof document !== 'undefined') {
        document.cookie = 'zarkhez_auth=; path=/; max-age=0; SameSite=Lax';
      }
      if (active) {
        setAuthorized(false);
        router.replace('/');
      }
    };

    void verifySession();

    return () => {
      active = false;
    };
  }, [pathname, isPublicWelcomeRoute, locale, router]);

  // If this is the public Welcome / Login / Sign Up page, render immediately
  if (isPublicWelcomeRoute) {
    return <>{children}</>;
  }

  // If on an inner interface route and not authorized, NEVER render inner interface
  if (!authorized) {
    return (
      <div className="min-h-[100dvh] bg-[#062409] flex flex-col items-center justify-center p-6 text-white text-center select-none">
        <div className="w-20 h-20 rounded-[22px] bg-[#062409] p-2 shadow-[0_0_40px_rgba(95,165,46,0.5)] border-2 border-emerald-400/50 flex items-center justify-center animate-pulse mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/zarkhez-logo-mark.png"
            alt="Zarkhez Logo"
            className="w-full h-full object-cover rounded-xl"
          />
        </div>
        <div className="w-8 h-8 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-3" />
        <h2 className="text-sm sm:text-base font-black text-white">
          {locale === 'ur'
            ? 'لاگ ان کی تصدیق کی جا رہی ہے...'
            : 'Verifying Login & Sign Up...'}
        </h2>
        <p className="text-xs text-cream/75 mt-1">
          {locale === 'ur'
            ? 'اندرونی انٹرفیس صرف لاگ ان صارفین کے لیے ہے'
            : 'Access requires Login or Sign Up'}
        </p>
      </div>
    );
  }

  // User is verified authenticated: render protected inner interface
  return <>{children}</>;
}
