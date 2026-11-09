'use client';

import React, { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import {
  ArrowLeft,
  CheckCircle2,
  LogOut,
  Volume2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import {
  FarmerPersonaCard,
  GoogleLogoSvg,
} from '@/components/cards/FarmerPersonaCard';
import {
  deleteAllUserData,
  deriveGoogleIdentityFromEmail,
  FarmerProfile,
  generateFarmerPersonaId,
  getSavedProfile,
  saveProfile,
  signOutFarmer,
  syncSupabaseAuthSession,
  triggerSupabaseGoogleOAuth,
} from '@/lib/supabase/client';
import {
  getEffectiveGoogleClientId,
  launchRealGoogleAccountChooser,
} from '@/lib/google-auth';
import { getAllCrops } from '@/lib/calendar';

export default function ProfilePage() {
  const t = useTranslations('auth');
  const tApp = useTranslations('app');
  const locale = useLocale() as 'ur' | 'en';
  const router = useRouter();
  const crops = getAllCrops();

  const [profile, setProfile] = useState<FarmerProfile>(() =>
    getSavedProfile()
  );
  const [fullName, setFullName] = useState('');
  const [fatherOrFarmName, setFatherOrFarmName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [villageOrTehsil, setVillageOrTehsil] = useState('');
  const [placeName, setPlaceName] = useState(() => getSavedProfile().placeName || 'Faisalabad, Punjab');
  const [totalAcres, setTotalAcres] = useState('5');
  const [selectedCrops, setSelectedCrops] = useState<string[]>(['wheat']);
  const [autoSpeakVoice, setAutoSpeakVoice] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState(false);

  useEffect(() => {
    const p = getSavedProfile();
    setProfile(p);
    setFullName(p.fullName);
    setFatherOrFarmName(p.fatherOrFarmName);
    setEmail(p.email);
    setPhone(p.phone);
    setVillageOrTehsil(p.villageOrTehsil);
    setPlaceName(p.placeName);
    setTotalAcres(String(p.totalAcres || 5));
    setSelectedCrops(p.primaryCrops?.length ? p.primaryCrops : ['wheat']);
    setAutoSpeakVoice(p.autoSpeakVoice ?? true);

    syncSupabaseAuthSession().then((synced) => {
      if (synced) {
        setProfile(synced);
        setFullName(synced.fullName);
        setEmail(synced.email);
      }
    });
  }, []);

  const toggleCrop = (cropKey: string) => {
    setSelectedCrops((prev) =>
      prev.includes(cropKey)
        ? prev.length > 1
          ? prev.filter((k) => k !== cropKey)
          : prev
        : [...prev, cropKey]
    );
  };

  const handleGoogleOAuthButton = async () => {
    const activeClientId = getEffectiveGoogleClientId();
    if (activeClientId) {
      try {
        const realUser = await launchRealGoogleAccountChooser(activeClientId);
        const farmerId =
          profile.farmerId ||
          generateFarmerPersonaId(realUser.email || realUser.sub);
        const updated = await saveProfile({
          farmerId,
          fullName: realUser.name,
          email: realUser.email,
          avatarUrl:
            realUser.picture ||
            deriveGoogleIdentityFromEmail(realUser.email, realUser.name)
              .avatarUrl,
          authProvider: 'google',
          isAuthenticated: true,
          language: locale,
        });
        setProfile(updated);
        setFullName(updated.fullName);
        setEmail(updated.email);
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 3500);
        return;
      } catch {
        // fallback below
      }
    }

    const res = await triggerSupabaseGoogleOAuth(`/${locale}/profile`);
    if (!res.startedRedirect) {
      const el = document.getElementById('google-email-input');
      el?.focus();
    }
  };

  const handleSavePersona = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim() || 'kisan@gmail.com';
    const derived = deriveGoogleIdentityFromEmail(cleanEmail, fullName.trim());
    const farmerId = profile.farmerId || derived.farmerId;

    const updated = await saveProfile({
      farmerId,
      fullName: derived.fullName,
      fatherOrFarmName: fatherOrFarmName.trim(),
      email: derived.email,
      avatarUrl: profile.avatarUrl || derived.avatarUrl,
      phone: phone.trim(),
      villageOrTehsil: villageOrTehsil.trim(),
      placeName: placeName.trim() || 'Multan, Punjab',
      totalAcres: Math.max(0, parseFloat(totalAcres) || 0),
      primaryCrops: selectedCrops,
      authProvider: 'google',
      isAuthenticated: true,
      autoSpeakVoice,
      language: locale,
    });

    setProfile(updated);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3500);
  };

  const handleSignOut = async () => {
    await signOutFarmer();
    router.push('/');
  };

  const handleDeleteData = async () => {
    await deleteAllUserData();
    setDeletedNotice(true);
    setTimeout(() => setDeletedNotice(false), 4000);
  };

  const previewProfile: FarmerProfile = {
    ...profile,
    farmerId:
      profile.farmerId ||
      generateFarmerPersonaId(email || phone || fullName || 'zarkhez'),
    fullName:
      fullName.trim() ||
      profile.fullName ||
      (locale === 'ur' ? 'آپ کا نام' : 'Your Name'),
    fatherOrFarmName: fatherOrFarmName.trim(),
    email: email.trim(),
    phone: phone.trim(),
    villageOrTehsil: villageOrTehsil.trim(),
    placeName: placeName.trim() || 'Multan, Punjab',
    totalAcres: Math.max(0, parseFloat(totalAcres) || 0),
    primaryCrops: selectedCrops,
    isAuthenticated: true,
    joinedAt: profile.joinedAt || new Date().toISOString().slice(0, 10),
  };

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas">
      {/* Header */}
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[32px] px-4 sm:px-5 pt-4 pb-7 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link
              href="/home"
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center text-white"
              aria-label={tApp('back')}
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={34} lightText showText={false} />
          </div>
          <LanguageToggle variant="glass" />
        </div>

        <div className="mt-4">
          <h1 className="font-extrabold text-2xl text-white">
            {t('personaCardTitle')}
          </h1>
          <p className="text-xs text-cream mt-0.5">{t('personaSubtitle')}</p>
        </div>
      </header>

      <main className="px-5 mt-5 space-y-5">
        {/* Live Digital Zarkhez Kisan ID Card */}
        <FarmerPersonaCard profile={previewProfile} />

        {/* Google Sign-In Button */}
        {!profile.isAuthenticated && (
          <button
            type="button"
            onClick={handleGoogleOAuthButton}
            className="w-full min-h-[54px] bg-white hover:bg-cream/40 text-ink font-extrabold text-base rounded-full shadow-soft border-2 border-olive/25 flex items-center justify-center gap-3 transition-all active:scale-98"
          >
            <GoogleLogoSvg className="w-5 h-5" />
            <span>{t('signInWithGoogle')}</span>
          </button>
        )}

        {/* Personal Information & Google Account Form */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/12 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-extrabold text-base text-ink flex items-center gap-2">
              <GoogleLogoSvg className="w-5 h-5" />
              <span>{t('googleModalTitle')}</span>
            </h2>
            {profile.isAuthenticated && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-olive bg-olive/12 px-2.5 py-1 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('googleConnected')}
              </span>
            )}
          </div>

          <p className="text-xs text-ink/70 leading-relaxed">
            {t('googleModalDesc')}
          </p>

          <form onSubmit={handleSavePersona} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-ink/80 mb-1">
                {t('emailLabel')} *
              </label>
              <input
                id="google-email-input"
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')}
                className="w-full min-h-[48px] px-4 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  {t('fullNameLabel')} *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('fullNamePlaceholder')}
                  className="w-full min-h-[48px] px-4 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  {t('fatherOrFarmLabel')}
                </label>
                <input
                  type="text"
                  value={fatherOrFarmName}
                  onChange={(e) => setFatherOrFarmName(e.target.value)}
                  placeholder={t('fatherOrFarmPlaceholder')}
                  className="w-full min-h-[48px] px-4 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  {t('phoneLabel')}
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('phonePlaceholder')}
                  className="w-full min-h-[48px] px-4 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  {t('totalAcresLabel')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  dir="ltr"
                  value={totalAcres}
                  onChange={(e) => setTotalAcres(e.target.value)}
                  className="w-full min-h-[48px] px-4 rounded-tile bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  {t('villageLabel')}
                </label>
                <input
                  type="text"
                  value={villageOrTehsil}
                  onChange={(e) => setVillageOrTehsil(e.target.value)}
                  placeholder={t('villagePlaceholder')}
                  className="w-full min-h-[48px] px-4 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/80 mb-1">
                  {t('districtLabel')}
                </label>
                <input
                  type="text"
                  value={placeName}
                  onChange={(e) => setPlaceName(e.target.value)}
                  className="w-full min-h-[48px] px-4 rounded-tile bg-canvas border border-olive/25 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>
            </div>

            {/* Primary Crops Multi-Select */}
            <div>
              <label className="block text-xs font-bold text-ink/80 mb-1.5">
                {t('primaryCropsLabel')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {crops.map((c) => {
                  const active = selectedCrops.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => toggleCrop(c.key)}
                      className={`min-h-[44px] rounded-tile text-xs font-bold transition-all ${
                        active
                          ? 'bg-olive text-white shadow-sm'
                          : 'bg-canvas text-ink hover:bg-olive/15'
                      }`}
                    >
                      {c.name[locale]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Auto-Speak Voice Toggle */}
            <label className="flex items-center justify-between gap-3 bg-cream/65 p-3.5 rounded-tile cursor-pointer border border-wheat/30">
              <div className="flex items-center gap-2.5">
                <Volume2 className="w-5 h-5 text-olive-dark flex-shrink-0" />
                <span className="text-xs font-bold text-ink">
                  {t('autoSpeakLabel')}
                </span>
              </div>
              <input
                type="checkbox"
                checked={autoSpeakVoice}
                onChange={(e) => setAutoSpeakVoice(e.target.checked)}
                className="w-5 h-5 accent-olive rounded"
              />
            </label>

            {savedNotice && (
              <div className="p-3 rounded-tile bg-olive/15 text-olive-dark text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {t('verifiedFarmer')} — ID: {profile.farmerId}
                </span>
              </div>
            )}

            <button
              type="submit"
              className="w-full min-h-[54px] rounded-full bg-olive hover:bg-olive-dark text-white font-extrabold text-base shadow-soft flex items-center justify-center gap-2 transition-all active:scale-98"
            >
              <Sparkles className="w-5 h-5 text-cream" />
              <span>
                {profile.isAuthenticated
                  ? t('updatePersonaBtn')
                  : t('createPersonaBtn')}
              </span>
            </button>
          </form>

          {profile.isAuthenticated && (
            <div className="pt-3 border-t border-olive/10 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => router.push('/home')}
                className="flex-1 min-h-[46px] rounded-full bg-canvas text-ink font-bold text-xs"
              >
                {tApp('back')}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 min-h-[46px] px-4 rounded-full bg-alert-red/10 text-alert-red font-bold text-xs"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('signOutBtn')}</span>
              </button>
            </div>
          )}
        </section>

        {/* Delete All Data Privacy Action */}
        <div className="text-center pt-2">
          {deletedNotice && (
            <p className="text-xs font-bold text-olive-dark mb-2">
              {tApp('deleteConfirm')}
            </p>
          )}
          <button
            type="button"
            onClick={handleDeleteData}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-full text-xs font-semibold text-alert-red hover:bg-alert-red/10"
          >
            <Trash2 className="w-4 h-4" />
            <span>{tApp('deleteMyData')}</span>
          </button>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
