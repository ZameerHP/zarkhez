'use client';

import React, { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Mail,
  User,
  LogIn,
  UserPlus,
  Check,
} from 'lucide-react';
import { GoogleLogoSvg } from '@/components/cards/FarmerPersonaCard';
import { OnboardingModal } from '@/components/auth/OnboardingModal';
import {
  deriveGoogleIdentityFromEmail,
  FarmerProfile,
  findRegisteredAccount,
  generateFarmerPersonaId,
  getSavedProfile,
  isEmailRegistered,
  saveProfile,
  signInGuestAnonymously,
  syncSupabaseAuthSession,
  triggerSupabaseGoogleOAuth,
} from '@/lib/supabase/client';
import {
  getEffectiveGoogleClientId,
  launchRealGoogleAccountChooser,
  RealGoogleUserInfo,
} from '@/lib/google-auth';

const DISTRICTS = [
  { name: 'Faisalabad, Punjab', ur: 'فیصل آباد، پنجاب', lat: 31.418, lon: 73.079 },
  { name: 'Sahiwal, Punjab', ur: 'ساہیوال، پنجاب', lat: 30.6682, lon: 73.1114 },
  { name: 'Lahore, Punjab', ur: 'لاہور، پنجاب', lat: 31.5204, lon: 74.3587 },
  { name: 'Sargodha, Punjab', ur: 'سرگودھا، پنجاب', lat: 32.0836, lon: 72.6711 },
  { name: 'Gujranwala, Punjab', ur: 'گوجرانوالہ، پنجاب', lat: 32.1877, lon: 74.1945 },
  { name: 'Rahim Yar Khan, Punjab', ur: 'رحیم یار خان، پنجاب', lat: 28.4202, lon: 70.3013 },
  { name: 'Bahawalpur, Punjab', ur: 'بہاولپور، پنجاب', lat: 29.3956, lon: 71.6836 },
  { name: 'Multan, Punjab', ur: 'ملتان، پنجاب', lat: 30.1575, lon: 71.5249 },
  { name: 'Hyderabad, Sindh', ur: 'حیدرآباد، سندھ', lat: 25.396, lon: 68.3578 },
  { name: 'Mardan, KPK', ur: 'مردان، کے پی کے', lat: 34.1986, lon: 72.0404 },
  { name: 'Swat, KPK', ur: 'سوات، کے پی کے', lat: 35.2227, lon: 72.4258 },
];

export default function SimpleWelcomePage() {
  const t = useTranslations('welcome');
  const tAuth = useTranslations('auth');
  const locale = useLocale() as 'ur' | 'en';
  const router = useRouter();
  const pathname = usePathname();

  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState(DISTRICTS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [accountNotFoundError, setAccountNotFoundError] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const existing = getSavedProfile();
    if (existing.email) {
      setEmailInput(existing.email);
      setNameInput(existing.fullName);
    }

    // Auto-detect user district via edge IP geocode header
    fetch('/api/geocode?detect=1')
      .then((res) => res.json())
      .then((data) => {
        if (data?.city) {
          const match = DISTRICTS.find((d) => d.name.toLowerCase().includes(data.city.toLowerCase()));
          if (match) setSelectedDistrict(match);
        }
      })
      .catch(() => {});

    syncSupabaseAuthSession();
  }, []);

  const switchLanguage = (nextLocale: 'ur' | 'en') => {
    if (nextLocale === locale) return;
    router.replace(pathname, { locale: nextLocale });
  };

  const handleGuestContinue = async () => {
    setSubmitting(true);
    await signInGuestAnonymously();
    router.push('/home');
  };

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    setOauthError(null);
    setAccountNotFoundError(false);

    const activeClientId = getEffectiveGoogleClientId();
    if (activeClientId) {
      try {
        const realUser: RealGoogleUserInfo = await launchRealGoogleAccountChooser(activeClientId);
        const existing = findRegisteredAccount(realUser.email) || getSavedProfile();
        const farmerId = existing.farmerId || generateFarmerPersonaId(realUser.email);
        const updated = await saveProfile({
          farmerId,
          fullName: realUser.name || realUser.email.split('@')[0],
          email: realUser.email,
          avatarUrl: realUser.picture || deriveGoogleIdentityFromEmail(realUser.email).avatarUrl,
          placeName: selectedDistrict.name,
          district: selectedDistrict.name.split(',')[0].trim(),
          lat: selectedDistrict.lat,
          lon: selectedDistrict.lon,
          authProvider: 'google',
          isAuthenticated: true,
          language: locale,
        });

        if (!updated.onboardingDone) {
          setShowOnboarding(true);
        } else {
          router.push('/home');
        }
        return;
      } catch (err) {
        // Fallback to Supabase OAuth or direct entry
      }
    }

    const res = await triggerSupabaseGoogleOAuth(`/${locale}/home`);
    if (!res.startedRedirect) {
      // If direct Google popup was closed, let user enter email cleanly
      setSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = emailInput.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setOauthError(locale === 'ur' ? 'براہ کرم درست ای میل درج کریں' : 'Please enter a valid email');
      return;
    }

    setSubmitting(true);
    setOauthError(null);
    setAccountNotFoundError(false);

    const existing = findRegisteredAccount(cleanEmail);

    if (authMode === 'login' && !existing && !isEmailRegistered(cleanEmail)) {
      setAccountNotFoundError(true);
      setOauthError(
        locale === 'ur'
          ? 'یہ ای میل رجسٹرڈ نہیں ہے! نیا اکاؤنٹ بنانے کے لیے سائن اپ کریں۔'
          : 'Account not found! This email is not registered. Switch to Sign Up to create your account.'
      );
      setSubmitting(false);
      return;
    }

    const identity = deriveGoogleIdentityFromEmail(cleanEmail, nameInput.trim());
    const profile = existing || getSavedProfile();

    const updated = await saveProfile({
      farmerId: profile.farmerId || identity.farmerId,
      fullName: nameInput.trim() || profile.fullName || identity.fullName,
      email: cleanEmail,
      avatarUrl: profile.avatarUrl || identity.avatarUrl,
      placeName: selectedDistrict.name,
      district: selectedDistrict.name.split(',')[0].trim(),
      lat: selectedDistrict.lat,
      lon: selectedDistrict.lon,
      authProvider: 'google',
      isAuthenticated: true,
      language: locale,
    });

    setSubmitting(false);
    if (!updated.onboardingDone && authMode === 'signup') {
      setShowOnboarding(true);
    } else {
      router.push('/home');
    }
  };

  return (
    <main className="min-h-[100dvh] flex flex-col justify-between px-4 sm:px-6 py-5 bg-gradient-to-b from-[#F4F5EE] via-[#ECEDE4] to-[#E3E5DA] text-ink max-w-md mx-auto">
      {/* Top Header: Brand Emblem & Language Toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/zarkhez-logo-mark.png"
            alt="Zarkhez Logo"
            className="w-10 h-10 object-contain drop-shadow-sm"
          />
          <div>
            <span className="font-black text-xl text-[#062409] tracking-tight">
              زرخیز <span className="text-olive text-sm font-bold">Zarkhez</span>
            </span>
          </div>
        </div>

        {/* Minimal Language Switcher */}
        <div className="flex rounded-full bg-white/80 border border-olive/20 p-1 shadow-sm">
          <button
            type="button"
            onClick={() => switchLanguage('ur')}
            className={`px-3 py-1 rounded-full text-xs font-black transition-all ${
              locale === 'ur' ? 'bg-[#062409] text-white shadow-sm' : 'text-ink/65 hover:text-ink'
            }`}
          >
            اردو
          </button>
          <button
            type="button"
            onClick={() => switchLanguage('en')}
            className={`px-3 py-1 rounded-full text-xs font-black transition-all ${
              locale === 'en' ? 'bg-[#062409] text-white shadow-sm' : 'text-ink/65 hover:text-ink'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="my-auto py-5 space-y-4">
        {/* Simple Headline */}
        <div className="text-center space-y-1">
          <h1 className="font-black text-2xl sm:text-3xl text-[#062409] leading-tight">
            {locale === 'ur' ? 'آپ کی کھیتی کا سچا دوست' : 'Smart Urdu Farming Assistant'}
          </h1>
          <p className="text-xs text-ink/75 max-w-xs mx-auto leading-relaxed">
            {locale === 'ur'
              ? 'پتے کی بیماری کی فوری تشخیص، موسم کا الرٹ اور قدرتی اردو آواز'
              : 'Instant leaf disease scan, live weather alerts & fluent Urdu voice'}
          </p>
        </div>

        {/* 1-Tap Guest Access (Highest Priority for Instant Frictionless Scan) */}
        <motion.button
          type="button"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleGuestContinue}
          className="w-full min-h-[54px] px-5 rounded-2xl bg-white hover:bg-canvas text-ink font-black text-sm sm:text-base border-2 border-olive/40 shadow-soft flex items-center justify-between transition-all group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-olive/15 text-olive flex items-center justify-center group-hover:bg-olive group-hover:text-white transition-colors">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="text-start">
              <span className="block font-black text-ink text-sm sm:text-base">
                {locale === 'ur' ? 'مہمان کسان (بغیر لاگ ان داخل ہوں)' : 'Continue as Guest'}
              </span>
              <span className="block text-[11px] text-ink/60 font-medium">
                {locale === 'ur' ? 'فوری سکین اور موسم دیکھنے کے لیے ٹیپ کریں' : 'Instant scan & weather without sign in'}
              </span>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-olive rtl:rotate-180 flex-shrink-0" />
        </motion.button>

        {/* Clean Login / Sign Up Box */}
        <div className="bg-white/95 rounded-2xl p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3.5">
          {/* Switcher Tab */}
          <div className="grid grid-cols-2 bg-canvas p-1 rounded-xl border border-olive/15">
            <button
              type="button"
              onClick={() => {
                setAuthMode('login');
                setOauthError(null);
                setAccountNotFoundError(false);
              }}
              className={`min-h-[38px] rounded-lg font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all ${
                authMode === 'login' ? 'bg-[#062409] text-white shadow-sm' : 'text-ink/65 hover:text-ink'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>{locale === 'ur' ? 'لاگ ان' : 'Log In'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('signup');
                setOauthError(null);
                setAccountNotFoundError(false);
              }}
              className={`min-h-[38px] rounded-lg font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all ${
                authMode === 'signup' ? 'bg-[#062409] text-white shadow-sm' : 'text-ink/65 hover:text-ink'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>{locale === 'ur' ? 'نیا اکاؤنٹ' : 'Sign Up'}</span>
            </button>
          </div>

          {/* Account Not Found Banner */}
          {oauthError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-alert-amber text-ink text-start space-y-2">
              <p className="text-xs font-bold leading-relaxed">{oauthError}</p>
              {accountNotFoundError && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signup');
                    setOauthError(null);
                    setAccountNotFoundError(false);
                  }}
                  className="w-full min-h-[36px] rounded-lg bg-olive text-white font-black text-xs"
                >
                  {locale === 'ur' ? 'نیا اکاؤنٹ بنانے کے لیے سائن اپ کریں' : 'Switch to Sign Up'}
                </button>
              )}
            </div>
          )}

          {/* Google 1-Tap Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="w-full min-h-[50px] px-4 rounded-xl bg-white hover:bg-canvas text-ink font-black text-sm border-2 border-ink/15 shadow-sm flex items-center justify-center gap-2.5 transition-all active:scale-98"
          >
            <GoogleLogoSvg className="w-5 h-5 flex-shrink-0" />
            <span>
              {authMode === 'login'
                ? locale === 'ur' ? 'گوگل سے لاگ ان کریں' : 'Continue with Google'
                : locale === 'ur' ? 'گوگل سے اکاؤنٹ بنائیں' : 'Sign Up with Google'}
            </span>
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px bg-ink/10 flex-1" />
            <span className="text-[11px] font-bold text-ink/40 uppercase">
              {locale === 'ur' ? 'یا ای میل سے' : 'or with email'}
            </span>
            <div className="h-px bg-ink/10 flex-1" />
          </div>

          {/* Clean Email Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-3 text-start">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'ای میل' : 'Email Address'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-ink/45 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="yourname@gmail.com"
                  className="w-full min-h-[46px] ps-10 pe-3 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>
            </div>

            {authMode === 'signup' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-3 overflow-hidden"
              >
                <div>
                  <label className="block text-xs font-bold text-ink/75 mb-1">
                    {locale === 'ur' ? 'کسان کا نام' : 'Your Name'}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-ink/45 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder={locale === 'ur' ? 'مثلاً محمد اکرم' : 'e.g. Muhammad Akram'}
                      className="w-full min-h-[46px] ps-10 pe-3 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink/75 mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-olive" />
                    <span>{locale === 'ur' ? 'اپنا ضلع منتخب کریں' : 'Select District'}</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {DISTRICTS.map((d) => {
                      const active = selectedDistrict.name === d.name;
                      return (
                        <button
                          key={d.name}
                          type="button"
                          onClick={() => setSelectedDistrict(d)}
                          className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                            active
                              ? 'bg-olive text-white shadow-sm'
                              : 'bg-canvas text-ink/70 border border-olive/20'
                          }`}
                        >
                          {locale === 'ur' ? d.ur : d.name.split(',')[0]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] rounded-xl bg-[#062409] hover:bg-olive-dark text-white font-black text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-98"
            >
              <span>
                {authMode === 'login'
                  ? locale === 'ur' ? 'لاگ ان کریں' : 'Log In'
                  : locale === 'ur' ? 'اکاؤنٹ بنائیں' : 'Create Account'}
              </span>
              <ArrowRight className="w-4 h-4 text-emerald-400 rtl:rotate-180" />
            </button>
          </form>
        </div>
      </div>

      {/* Footer Disclaimer */}
      <footer className="text-center pt-2">
        <p className="text-[11px] text-ink/50">
          {locale === 'ur'
            ? 'زرخیز — پاکستانی کسانوں کا ڈیجیٹل ساتھی'
            : 'Zarkhez — Built for Pakistani Farmers'}
        </p>
      </footer>

      {/* 4-Tap Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboarding}
        onComplete={() => router.push('/home')}
        onSkip={() => router.push('/home')}
        initialDistrict={selectedDistrict}
      />
    </main>
  );
}
