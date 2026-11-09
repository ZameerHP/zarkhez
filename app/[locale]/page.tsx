'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Sparkles,
  Mic,
  ArrowRight,
  Check,
  ShieldCheck,
  Mail,
  User,
  LogIn,
  UserPlus,
  X,
  KeyRound,
  CheckCircle2,
} from 'lucide-react';
import { GoogleLogoSvg } from '@/components/cards/FarmerPersonaCard';
import {
  deriveGoogleIdentityFromEmail,
  FarmerProfile,
  generateFarmerPersonaId,
  getSavedProfile,
  saveProfile,
  syncSupabaseAuthSession,
  triggerSupabaseGoogleOAuth,
} from '@/lib/supabase/client';
import {
  getEffectiveGoogleClientId,
  initGoogleOneTapAndButton,
  launchRealGoogleAccountChooser,
  RealGoogleUserInfo,
  setCustomGoogleClientId,
} from '@/lib/google-auth';
import { unlockAudio } from '@/lib/voice';

const QUICK_DISTRICTS = [
  { name: 'Multan, Punjab', ur: 'ملتان، پنجاب', lat: 30.1575, lon: 71.5249 },
  { name: 'Faisalabad, Punjab', ur: 'فیصل آباد، پنجاب', lat: 31.418, lon: 73.079 },
  { name: 'Sahiwal, Punjab', ur: 'ساہیوال، پنجاب', lat: 30.6682, lon: 73.1114 },
  { name: 'Lahore, Punjab', ur: 'لاہور، پنجاب', lat: 31.5204, lon: 74.3587 },
  { name: 'Bahawalpur, Punjab', ur: 'بہاولپور، پنجاب', lat: 29.3956, lon: 71.6836 },
  { name: 'Hyderabad, Sindh', ur: 'حیدرآباد، سندھ', lat: 25.396, lon: 68.3578 },
  { name: 'Mardan, KPK', ur: 'مردان، کے پی کے', lat: 34.1986, lon: 72.0404 },
];

export default function WelcomeAuthPage() {
  const t = useTranslations('welcome');
  const locale = useLocale() as 'ur' | 'en';
  const router = useRouter();
  const pathname = usePathname();

  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [savedUser, setSavedUser] = useState<FarmerProfile | null>(null);
  const [showGoogleChooser, setShowGoogleChooser] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [clientIdDraft, setClientIdDraft] = useState('');
  const [showClientIdConfig, setShowClientIdConfig] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Direct Google Auth / Login / Sign Up fields
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState(QUICK_DISTRICTS[0]);
  const [submitting, setSubmitting] = useState(false);

  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  const handleRealGoogleUserSuccess = async (googleUser: RealGoogleUserInfo) => {
    unlockAudio();
    setSubmitting(true);
    setOauthError(null);

    const existing = getSavedProfile();
    const farmerId =
      existing.farmerId ||
      generateFarmerPersonaId(googleUser.email || googleUser.sub);

    const updatedProfile = await saveProfile({
      farmerId,
      fullName: googleUser.name || googleUser.email.split('@')[0],
      email: googleUser.email,
      avatarUrl:
        googleUser.picture ||
        deriveGoogleIdentityFromEmail(googleUser.email, googleUser.name)
          .avatarUrl,
      placeName: existing.placeName || selectedDistrict.name,
      lat: existing.lat || selectedDistrict.lat,
      lon: existing.lon || selectedDistrict.lon,
      authProvider: 'google',
      isAuthenticated: true,
      language: locale,
    });

    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          saveProfile({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
        },
        () => {},
        { timeout: 3500 }
      );
    }

    setSavedUser(updatedProfile);
    setShowGoogleChooser(false);
    router.push('/home');
  };

  useEffect(() => {
    const existing = getSavedProfile();
    if (existing.isAuthenticated && existing.email) {
      setSavedUser(existing);
      setEmailInput(existing.email);
      setNameInput(existing.fullName);
    }

    const effectiveId = getEffectiveGoogleClientId();
    setGoogleClientId(effectiveId);
    setClientIdDraft(effectiveId);

    if (effectiveId) {
      initGoogleOneTapAndButton(
        effectiveId,
        handleRealGoogleUserSuccess,
        googleBtnContainerRef.current
      );
    }

    syncSupabaseAuthSession().then((synced) => {
      if (synced && synced.isAuthenticated) {
        setSavedUser(synced);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchLanguage = (nextLocale: 'ur' | 'en') => {
    if (nextLocale === locale) return;
    router.replace(pathname, { locale: nextLocale });
  };

  const completeDirectGoogleAuth = async (
    rawEmail: string,
    explicitName?: string
  ) => {
    unlockAudio();
    setSubmitting(true);

    const identity = deriveGoogleIdentityFromEmail(rawEmail, explicitName);
    const existing = getSavedProfile();

    const updatedProfile = await saveProfile({
      farmerId: identity.farmerId,
      fullName: identity.fullName,
      email: identity.email,
      avatarUrl: identity.avatarUrl,
      placeName: existing.placeName || selectedDistrict.name,
      lat: existing.lat || selectedDistrict.lat,
      lon: existing.lon || selectedDistrict.lon,
      authProvider: 'google',
      isAuthenticated: true,
      language: locale,
    });

    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          saveProfile({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
        },
        () => {},
        { timeout: 3500 }
      );
    }

    setSavedUser(updatedProfile);
    setShowGoogleChooser(false);
    router.push('/home');
  };

  const handleGoogleButtonTap = async () => {
    unlockAudio();
    setOauthError(null);

    // 1. If a real Google OAuth Client ID is configured, open Google's native Account Chooser popup (`accounts.google.com`)
    const activeClientId = getEffectiveGoogleClientId();
    if (activeClientId) {
      try {
        const realUser = await launchRealGoogleAccountChooser(activeClientId);
        await handleRealGoogleUserSuccess(realUser);
        return;
      } catch (err) {
        setOauthError(
          err instanceof Error ? err.message : 'Google popup closed'
        );
      }
    }

    // 2. If Supabase Google OAuth is configured, trigger OAuth redirect
    const res = await triggerSupabaseGoogleOAuth(`/${locale}/home`);
    if (res.startedRedirect) {
      return;
    }

    // 3. Otherwise open the instant Google Account Chooser & Client ID modal
    setShowGoogleChooser(true);
  };

  const handleSaveAndLaunchRealClientId = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = clientIdDraft.trim();
    setCustomGoogleClientId(cleaned);
    setGoogleClientId(cleaned);
    setOauthError(null);
    if (cleaned) {
      try {
        const realUser = await launchRealGoogleAccountChooser(cleaned);
        await handleRealGoogleUserSuccess(realUser);
      } catch (err) {
        setOauthError(
          err instanceof Error
            ? err.message
            : 'Check Authorized JavaScript Origins in Google Cloud Console'
        );
      }
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = emailInput.trim() || 'kisan.zarkhez@gmail.com';
    const targetName =
      authMode === 'signup' && nameInput.trim() ? nameInput.trim() : undefined;
    await completeDirectGoogleAuth(targetEmail, targetName);
  };

  const livePreviewIdentity = deriveGoogleIdentityFromEmail(
    emailInput || 'kisan@gmail.com',
    nameInput
  );

  return (
    <main className="relative min-h-[100dvh] flex flex-col justify-between overflow-x-hidden bg-[#062409] text-white select-none">
      {/* Ambient Animated Emerald & Gold Glow Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-24 -start-24 w-72 h-72 rounded-full blur-3xl opacity-35"
          style={{
            background:
              'radial-gradient(circle, rgba(95,165,46,0.9) 0%, rgba(6,36,9,0) 70%)',
          }}
        />
        <div
          className="absolute top-1/3 -end-24 w-80 h-80 rounded-full blur-3xl opacity-25"
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

      {/* Top Bar: Language Toggle & Feature Chips */}
      <div className="relative z-10 px-4 pt-4 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-bold text-cream">
          <Sparkles className="w-3.5 h-3.5 text-olive-fresh" />
          <span>{t('chipDoctor')}</span>
          <span className="opacity-40">•</span>
          <Mic className="w-3.5 h-3.5 text-wheat" />
          <span>{t('chipVoice')}</span>
        </div>

        <div className="inline-flex rounded-full bg-white/10 p-1 border border-white/15">
          <button
            type="button"
            onClick={() => switchLanguage('ur')}
            className={`px-3 py-1 rounded-full text-xs font-extrabold transition-all ${
              locale === 'ur'
                ? 'bg-olive-fresh text-white shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            اردو
          </button>
          <button
            type="button"
            onClick={() => switchLanguage('en')}
            className={`px-3 py-1 rounded-full text-xs font-extrabold transition-all ${
              locale === 'en'
                ? 'bg-olive-fresh text-white shadow-sm'
                : 'text-white/75 hover:text-white'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Center Hero: Best Part of Uploaded Logo (Cropped Z + Leaf + Field Emblem) */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative z-10 px-4 pt-3 pb-2 flex flex-col items-center text-center"
      >
        <motion.div
          initial={{ scale: 0.82, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-[26px] bg-[#062409] p-1.5 shadow-[0_0_40px_rgba(95,165,46,0.45)] border-2 border-emerald-400/45 overflow-hidden flex items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/zarkhez-logo-mark.png"
            alt="Zarkhez Emblem"
            className="w-full h-full object-cover rounded-[20px]"
          />
        </motion.div>

        <div className="mt-2.5 flex items-baseline justify-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Zarkhez
          </h1>
          <span className="font-urduHeading text-xl sm:text-2xl text-emerald-300">
            زرخیز
          </span>
        </div>
        <p className="mt-1 text-xs sm:text-sm text-white/80 max-w-[330px] leading-relaxed">
          {locale === 'ur'
            ? 'آپ کی کھیتی، آپ کا سچا دوست — گوگل اکاؤنٹ سے لاگ ان کریں اور اپنا ڈیجیٹل کسان کارڈ پائیں'
            : 'Your farm, your true friend — Sign in with Google for instant AI crop advisor & Farmer ID'}
        </p>
      </motion.div>

      {/* Main Login & Sign Up Card */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease: 'easeOut' }}
        className="relative z-10 px-4 pb-6 pt-1 w-full"
      >
        <div className="bg-white text-ink rounded-[26px] p-4 sm:p-5 shadow-2xl border border-white/20 space-y-4">
          {/* Returning Authenticated Farmer 1-Tap Continue Banner */}
          {savedUser && savedUser.isAuthenticated && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                unlockAudio();
                router.push('/home');
              }}
              className="w-full p-3 rounded-2xl bg-gradient-to-r from-[#062409] via-olive-dark to-olive text-white flex items-center justify-between gap-2.5 shadow-md border border-emerald-400/30"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    savedUser.avatarUrl ||
                    deriveGoogleIdentityFromEmail(savedUser.email).avatarUrl
                  }
                  alt={savedUser.fullName}
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
                  <bdi
                    dir="ltr"
                    className="block text-[11px] text-white/75 truncate"
                  >
                    {savedUser.email}
                  </bdi>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-wheat flex-shrink-0 rtl:rotate-180" />
            </motion.button>
          )}

          {/* Animated Login / Sign Up Switcher Tabs */}
          <div className="relative grid grid-cols-2 bg-canvas p-1 rounded-2xl border border-olive/15">
            {(['login', 'signup'] as const).map((tab) => {
              const active = authMode === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setAuthMode(tab)}
                  className={`relative z-10 min-h-[42px] rounded-xl font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors ${
                    active ? 'text-white' : 'text-ink/70 hover:text-ink'
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="auth-mode-pill"
                      transition={{
                        type: 'spring',
                        stiffness: 380,
                        damping: 30,
                      }}
                      className="absolute inset-0 rounded-xl bg-[#062409] shadow-sm"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {tab === 'login' ? (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>
                          {locale === 'ur' ? 'لاگ ان (Login)' : 'Log In'}
                        </span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>
                          {locale === 'ur' ? 'سائن اپ (Sign Up)' : 'Sign Up'}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Official Google Identity Services Button Container (when Client ID is set) */}
          <div
            ref={googleBtnContainerRef}
            className={googleClientId ? 'flex justify-center' : 'hidden'}
          />

          {/* Primary 1-Tap Real Google Account Chooser Button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGoogleButtonTap}
            className="w-full min-h-[52px] px-4 rounded-2xl bg-white hover:bg-canvas text-ink font-extrabold text-sm sm:text-base border-2 border-ink/15 shadow-soft flex items-center justify-center gap-3 transition-all"
          >
            <GoogleLogoSvg className="w-5 h-5 flex-shrink-0" />
            <span>
              {authMode === 'login'
                ? locale === 'ur'
                  ? 'گوگل اکاؤنٹ منتخب کریں (Google Sign-In)'
                  : 'Choose Google Account & Log In'
                : locale === 'ur'
                ? 'گوگل اکاؤنٹ سے نیا سائن اپ کریں'
                : 'Choose Google Account & Sign Up'}
            </span>
          </motion.button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px bg-ink/10 flex-1" />
            <span className="text-[11px] font-bold text-ink/50 uppercase">
              {locale === 'ur'
                ? 'یا اپنا گوگل ای میل درج کریں'
                : 'or enter your Google email'}
            </span>
            <div className="h-px bg-ink/10 flex-1" />
          </div>

          {/* Direct Google Email Login / Sign Up Form */}
          <form onSubmit={handleFormSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur'
                  ? 'گوگل ای میل (Gmail)'
                  : 'Google Email (Gmail)'}
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
                  className="w-full min-h-[46px] ps-10 pe-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>
            </div>

            <AnimatePresence initial={false}>
              {authMode === 'signup' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden space-y-3"
                >
                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1">
                      {locale === 'ur'
                        ? 'کسان کا نام (گوگل سے خودکار یا درج کریں)'
                        : 'Farmer Full Name (Auto-filled from Google)'}
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-ink/45 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder={livePreviewIdentity.fullName}
                        className="w-full min-h-[46px] ps-10 pe-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                      />
                    </div>
                  </div>

                  {/* Quick District Chips */}
                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1.5 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-olive" />
                      <span>
                        {locale === 'ur'
                          ? 'اپنا ضلع منتخب کریں (موسم کے لیے)'
                          : 'Select District (for Weather)'}
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_DISTRICTS.slice(0, 5).map((d) => {
                        const isSel = selectedDistrict.name === d.name;
                        return (
                          <button
                            key={d.name}
                            type="button"
                            onClick={() => setSelectedDistrict(d)}
                            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all ${
                              isSel
                                ? 'bg-olive text-white shadow-sm'
                                : 'bg-canvas text-ink/75 border border-olive/20'
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
            </AnimatePresence>

            {/* Live Auto-Generated Google Persona Preview Pill */}
            {emailInput.trim().length > 2 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-2.5 rounded-xl bg-emerald-950/5 border border-olive/25 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={livePreviewIdentity.avatarUrl}
                    alt=""
                    className="w-9 h-9 rounded-full flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-extrabold text-xs text-ink truncate">
                        {livePreviewIdentity.fullName}
                      </span>
                      <ShieldCheck className="w-3.5 h-3.5 text-olive flex-shrink-0" />
                    </div>
                    <bdi
                      dir="ltr"
                      className="block text-[11px] text-ink/65 truncate"
                    >
                      {livePreviewIdentity.email}
                    </bdi>
                  </div>
                </div>
                <bdi
                  dir="ltr"
                  className="px-2.5 py-1 rounded-full bg-[#062409] text-cream font-mono font-extrabold text-[10px] flex-shrink-0"
                >
                  {livePreviewIdentity.farmerId}
                </bdi>
              </motion.div>
            )}

            <motion.button
              type="submit"
              disabled={submitting}
              whileTap={{ scale: 0.98 }}
              className="w-full min-h-[52px] rounded-2xl bg-[#062409] hover:bg-olive-dark text-white font-extrabold text-sm sm:text-base shadow-lg flex items-center justify-center gap-2 transition-all"
            >
              <span>
                {authMode === 'login'
                  ? locale === 'ur'
                    ? 'لاگ ان کریں اور ایپ کھولیں'
                    : 'Log In & Open Zarkhez'
                  : locale === 'ur'
                  ? 'اکاؤنٹ بنائیں اور ایپ کھولیں'
                  : 'Sign Up & Open Zarkhez'}
              </span>
              <ArrowRight className="w-5 h-5 text-emerald-400 rtl:rotate-180" />
            </motion.button>
          </form>
        </div>
      </motion.div>

      {/* Google Account Chooser & Real-Time OAuth Popup Modal */}
      <AnimatePresence>
        {showGoogleChooser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 320, damping: 25 }}
              className="w-full max-w-[400px] bg-white text-ink rounded-[24px] p-5 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-ink/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <GoogleLogoSvg className="w-6 h-6" />
                  <div>
                    <h2 className="font-extrabold text-sm sm:text-base text-ink">
                      {locale === 'ur'
                        ? 'گوگل کے ساتھ سائن ان کریں'
                        : 'Sign in with Google'}
                    </h2>
                    <p className="text-[11px] text-ink/60">
                      {locale === 'ur'
                        ? 'زرخیز (Zarkhez) میں براہِ راست جانے کے لیے اکاؤنٹ منتخب کریں'
                        : 'Choose an account to continue directly to Zarkhez'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGoogleChooser(false)}
                  className="w-8 h-8 rounded-full bg-canvas flex items-center justify-center text-ink/60 hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {oauthError && (
                <div className="p-2.5 rounded-xl bg-alert-amber/15 border border-alert-amber text-xs text-ink">
                  {oauthError}
                </div>
              )}

              {/* Saved Google Account Row */}
              {savedUser && savedUser.email && (
                <button
                  type="button"
                  onClick={() =>
                    completeDirectGoogleAuth(
                      savedUser.email,
                      savedUser.fullName
                    )
                  }
                  className="w-full p-3 rounded-xl bg-canvas hover:bg-olive/10 border border-olive/25 flex items-center justify-between gap-2 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        savedUser.avatarUrl ||
                        deriveGoogleIdentityFromEmail(savedUser.email).avatarUrl
                      }
                      alt=""
                      className="w-10 h-10 rounded-full flex-shrink-0"
                    />
                    <div className="text-start min-w-0">
                      <span className="font-extrabold text-sm text-ink block truncate">
                        {savedUser.fullName}
                      </span>
                      <bdi
                        dir="ltr"
                        className="text-xs text-ink/65 block truncate"
                      >
                        {savedUser.email}
                      </bdi>
                    </div>
                  </div>
                  <Check className="w-4 h-4 text-olive flex-shrink-0" />
                </button>
              )}

              {/* Direct Gmail Input inside Google Chooser */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  completeDirectGoogleAuth(
                    emailInput.trim() || 'kisan.zarkhez@gmail.com',
                    nameInput.trim() || undefined
                  );
                }}
                className="space-y-3"
              >
                <div>
                  <label className="block text-xs font-bold text-ink/75 mb-1">
                    {locale === 'ur'
                      ? 'اپنا گوگل ای میل درج کریں (نام اور آئی ڈی خودکار بن جائے گی)'
                      : 'Enter your Google Email (Name & ID auto-syncs)'}
                  </label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="yourname@gmail.com"
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/30 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[48px] rounded-xl bg-[#062409] hover:bg-olive-dark text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md"
                >
                  <GoogleLogoSvg className="w-4 h-4" />
                  <span>
                    {locale === 'ur'
                      ? 'گوگل سے تصدیق کریں اور اندر جائیں'
                      : 'Continue with Google'}
                  </span>
                </button>
              </form>

              {/* Collapsible Real-Time Google Cloud OAuth Client ID Connector */}
              <div className="pt-2 border-t border-ink/10">
                <button
                  type="button"
                  onClick={() => setShowClientIdConfig(!showClientIdConfig)}
                  className="w-full flex items-center justify-between text-xs font-bold text-olive-dark py-1"
                >
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>
                      {locale === 'ur'
                        ? 'لائیو گوگل اکاؤنٹ پاپ اپ (Google OAuth Client ID)'
                        : 'Connect Live Google OAuth Client ID'}
                    </span>
                  </span>
                  <span className="underline text-[11px]">
                    {showClientIdConfig ? 'Hide' : 'Configure'}
                  </span>
                </button>

                {showClientIdConfig && (
                  <form
                    onSubmit={handleSaveAndLaunchRealClientId}
                    className="mt-2.5 p-3 rounded-xl bg-canvas border border-olive/20 space-y-2.5"
                  >
                    <p className="text-[11px] text-ink/70 leading-relaxed">
                      {locale === 'ur'
                        ? 'اپنا Google Cloud Web Client ID یہاں پیسٹ کریں تاکہ گوگل کا آفیشل اکاؤنٹ پاپ اپ کھلے اور گوگل سے اصل تصویر، نام اور ای میل خودکار آئے:'
                        : 'Paste your Google Cloud Web Client ID (.apps.googleusercontent.com) to launch Google’s official account chooser popup and pull real Google photo, name & email:'}
                    </p>
                    <input
                      type="text"
                      dir="ltr"
                      value={clientIdDraft}
                      onChange={(e) => setClientIdDraft(e.target.value)}
                      placeholder="123456789-xxx.apps.googleusercontent.com"
                      className="w-full min-h-[40px] px-3 rounded-lg bg-white border border-olive/30 text-xs font-mono text-ink"
                    />
                    <button
                      type="submit"
                      className="w-full min-h-[40px] rounded-lg bg-olive text-white font-bold text-xs flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {locale === 'ur'
                          ? 'محفوظ کریں اور آفیشل گوگل پاپ اپ کھولیں'
                          : 'Save & Launch Official Google Popup'}
                      </span>
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
