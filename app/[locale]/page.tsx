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
  Mic,
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

export default function WelcomePage() {
  const t = useTranslations('welcome');
  const tAuth = useTranslations('auth');
  const locale = useLocale() as 'ur' | 'en';
  const router = useRouter();
  const pathname = usePathname();

  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [savedUser, setSavedUser] = useState<FarmerProfile | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState(DISTRICTS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [accountNotFoundError, setAccountNotFoundError] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const existing = getSavedProfile();
    if (existing.isAuthenticated && existing.email) {
      setSavedUser(existing);
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

    syncSupabaseAuthSession().then((synced) => {
      if (synced && synced.isAuthenticated) {
        setSavedUser(synced);
      }
    });
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
      } catch {
        // Fallback below
      }
    }

    const res = await triggerSupabaseGoogleOAuth(`/${locale}/home`);
    if (!res.startedRedirect) {
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
    <main className="relative min-h-[100dvh] bg-[#062409] text-white overflow-x-hidden flex flex-col justify-between selection:bg-emerald-500 selection:text-white max-w-md mx-auto">
      {/* Decorative Agriculture Field Glows & Vignette */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-32 -start-32 w-80 h-80 rounded-full blur-3xl opacity-35"
          style={{
            background:
              'radial-gradient(circle, rgba(95,165,46,0.95) 0%, rgba(6,36,9,0) 70%)',
          }}
        />
        <div
          className="absolute top-1/4 -end-32 w-80 h-80 rounded-full blur-3xl opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(200,150,46,0.85) 0%, rgba(6,36,9,0) 70%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      {/* Top Bar: Feature Chips & Minimal Language Switcher */}
      <div className="relative z-10 px-4 pt-4 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-bold text-cream">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>{locale === 'ur' ? 'زرعی ڈاکٹر' : 'Crop Doctor'}</span>
          <span className="opacity-40">•</span>
          <Mic className="w-3.5 h-3.5 text-wheat" />
          <span>{locale === 'ur' ? 'اردو آواز' : 'Urdu Voice'}</span>
        </div>

        <div className="inline-flex rounded-full bg-white/10 p-1 border border-white/15">
          <button
            type="button"
            onClick={() => switchLanguage('ur')}
            className={`px-3 py-1 rounded-full text-xs font-black transition-all ${
              locale === 'ur'
                ? 'bg-olive text-white shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            اردو
          </button>
          <button
            type="button"
            onClick={() => switchLanguage('en')}
            className={`px-3 py-1 rounded-full text-xs font-black transition-all ${
              locale === 'en'
                ? 'bg-olive text-white shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Big Logo in Top Center with Glow */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative z-10 px-4 pt-4 pb-2 flex flex-col items-center text-center"
      >
        <motion.div
          initial={{ scale: 0.82, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-[28px] bg-[#062409] p-1.5 shadow-[0_0_45px_rgba(95,165,46,0.55)] border-2 border-emerald-400/50 overflow-hidden flex items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/zarkhez-logo-mark.png"
            alt="Zarkhez Logo"
            className="w-full h-full object-cover rounded-[22px]"
          />
        </motion.div>

        <div className="mt-3 flex items-baseline justify-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Zarkhez
          </h1>
          <span className="font-urduHeading text-2xl sm:text-3xl text-emerald-300">
            زرخیز
          </span>
        </div>
        <p className="mt-1 text-xs sm:text-sm text-white/85 max-w-[320px] leading-relaxed">
          {locale === 'ur'
            ? 'آپ کی کھیتی کا سچا دوست — بیماری کی فوری تشخیص اور رہنمائی'
            : 'Your farm, your true friend — Instant leaf disease diagnosis & Urdu advisor'}
        </p>
      </motion.div>

      {/* Main Login / Sign Up Card */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease: 'easeOut' }}
        className="relative z-10 px-4 pb-5 pt-1 w-full"
      >
        <div className="bg-white text-ink rounded-[26px] p-4 sm:p-5 shadow-2xl border border-white/20 space-y-3.5">
          {/* Returning Authenticated Farmer 1-Tap Continue Banner */}
          {savedUser && savedUser.isAuthenticated && (
            <button
              type="button"
              onClick={() => router.push('/home')}
              className="w-full p-3 rounded-2xl bg-gradient-to-r from-[#062409] via-olive-dark to-olive text-white flex items-center justify-between gap-2.5 shadow-md border border-emerald-400/30 transition-transform active:scale-98"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    savedUser.avatarUrl ||
                    deriveGoogleIdentityFromEmail(savedUser.email).avatarUrl
                  }
                  alt=""
                  className="w-10 h-10 rounded-full object-cover border-2 border-wheat flex-shrink-0"
                />
                <div className="text-start min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-extrabold text-xs sm:text-sm truncate">
                      {locale === 'ur'
                        ? `${savedUser.fullName} کے طور پر جاری رکھیں`
                        : `Continue as ${savedUser.fullName}`}
                    </span>
                    <bdi
                      dir="ltr"
                      className="px-2 py-0.5 rounded-full bg-wheat text-ink font-mono font-extrabold text-[10px]"
                    >
                      {savedUser.farmerId}
                    </bdi>
                  </div>
                  <bdi dir="ltr" className="block text-[11px] text-white/75 truncate">
                    {savedUser.email}
                  </bdi>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-wheat flex-shrink-0 rtl:rotate-180" />
            </button>
          )}

          {/* 1-Tap Guest Access (Highest Priority: Scan immediately with zero forms) */}
          <button
            type="button"
            onClick={handleGuestContinue}
            className="w-full min-h-[50px] px-4 rounded-2xl bg-white hover:bg-canvas text-ink font-black text-xs sm:text-sm border-2 border-olive/40 shadow-sm flex items-center justify-between transition-all group"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-olive/15 flex items-center justify-center text-olive group-hover:bg-olive group-hover:text-white transition-colors">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-xs sm:text-sm">
                {locale === 'ur' ? 'مہمان کسان (بغیر لاگ ان داخل ہوں)' : 'Continue as Guest (No Login)'}
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-olive rtl:rotate-180" />
          </button>

          {/* Simple Tab Switcher: Log In vs Sign Up */}
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

          {/* Error Banner when Account Not Found */}
          {oauthError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-alert-amber text-ink text-start space-y-2">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-alert-amber flex-shrink-0 mt-0.5" />
                <p className="text-xs font-bold leading-relaxed">{oauthError}</p>
              </div>
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

          {/* 1-Tap Google Sign-In Button */}
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
              {locale === 'ur' ? 'یا ای میل درج کریں' : 'or enter email'}
            </span>
            <div className="h-px bg-ink/10 flex-1" />
          </div>

          {/* Direct Email Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-3 text-start">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'ای میل ایڈریس' : 'Email Address'}
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
                  ? locale === 'ur' ? 'لاگ ان کریں اور شروع کریں' : 'Log In'
                  : locale === 'ur' ? 'اکاؤنٹ بنائیں اور شروع کریں' : 'Create Account'}
              </span>
              <ArrowRight className="w-4 h-4 text-emerald-400 rtl:rotate-180" />
            </button>
          </form>
        </div>
      </motion.div>

      {/* Footer */}
      <footer className="text-center pb-3">
        <p className="text-[11px] text-white/50">
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
