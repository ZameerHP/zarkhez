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
  MapPin,
  Phone,
  Sprout,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import {
  deleteAllUserData,
  FarmerProfile,
  generateFarmerPersonaId,
  getSavedProfile,
  saveProfile,
  signOutFarmer,
  syncSupabaseAuthSession,
} from '@/lib/supabase/client';
import { getAllCrops } from '@/lib/calendar';

export default function ProfilePage() {
  const t = useTranslations('auth');
  const tApp = useTranslations('app');
  const locale = useLocale() as 'ur' | 'en';
  const router = useRouter();
  const crops = getAllCrops();

  const [profile, setProfile] = useState<FarmerProfile>(() => getSavedProfile());
  const [fullName, setFullName] = useState('');
  const [fatherOrFarmName, setFatherOrFarmName] = useState('');
  const [phone, setPhone] = useState('');
  const [villageOrTehsil, setVillageOrTehsil] = useState('');
  const [placeName, setPlaceName] = useState('Faisalabad, Punjab');
  const [totalAcres, setTotalAcres] = useState('5');
  const [selectedCrops, setSelectedCrops] = useState<string[]>(['wheat']);
  const [autoSpeakVoice, setAutoSpeakVoice] = useState(true);
  const [preferredVoice, setPreferredVoice] = useState<'ur-PK-UzmaNeural' | 'ur-PK-AsadNeural'>('ur-PK-UzmaNeural');
  const [voiceSpeed, setVoiceSpeed] = useState<number>(1.0);
  const [savedNotice, setSavedNotice] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const p = getSavedProfile();
    setProfile(p);
    setFullName(p.fullName);
    setFatherOrFarmName(p.fatherOrFarmName);
    setPhone(p.phone);
    setVillageOrTehsil(p.villageOrTehsil);
    setPlaceName(p.placeName || 'Faisalabad, Punjab');
    setTotalAcres(String(p.totalAcres || 5));
    setSelectedCrops(p.primaryCrops?.length ? p.primaryCrops : ['wheat']);
    setAutoSpeakVoice(p.autoSpeakVoice ?? true);
    setPreferredVoice((p.preferredVoice as any) || 'ur-PK-UzmaNeural');
    setVoiceSpeed(p.voiceSpeed || 1.0);

    syncSupabaseAuthSession().then((synced) => {
      if (synced) {
        setProfile(synced);
        setFullName(synced.fullName);
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

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const farmerId =
      profile.farmerId ||
      generateFarmerPersonaId(phone || fullName || String(Date.now()));

    const updated = await saveProfile({
      ...profile,
      farmerId,
      fullName: fullName.trim() || (locale === 'ur' ? 'کسان بھائی' : 'Farmer Friend'),
      fatherOrFarmName: fatherOrFarmName.trim(),
      phone: phone.trim(),
      villageOrTehsil: villageOrTehsil.trim(),
      placeName: placeName.trim() || 'Faisalabad, Punjab',
      district: placeName.split(',')[0].trim(),
      totalAcres: Math.max(0, parseFloat(totalAcres) || 0),
      primaryCrops: selectedCrops,
      mainCrops: selectedCrops,
      autoSpeakVoice,
      preferredVoice,
      voiceSpeed,
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

  const handleConfirmDeleteAll = async () => {
    setDeleting(true);
    await deleteAllUserData();
    setDeleting(false);
    setShowDeleteModal(false);
    setDeletedNotice(true);
    setTimeout(() => {
      router.push('/');
    }, 1200);
  };

  const initials = (fullName || profile.fullName || 'ZK')
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas overflow-x-hidden">
      {/* Clean Header */}
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[28px] px-5 pt-4 pb-6 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link
              href="/home"
              className="w-10 h-10 rounded-full glass flex items-center justify-center text-white"
              aria-label={tApp('back')}
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={32} lightText showText={false} />
          </div>
          <LanguageToggle variant="glass" />
        </div>

        <div className="mt-3">
          <h1 className="font-extrabold text-xl text-white">
            {locale === 'ur' ? 'کسان پروفائل' : 'Farmer Profile'}
          </h1>
          <p className="text-xs text-cream/90 mt-0.5">
            {locale === 'ur'
              ? 'اپنی ذاتی معلومات اور فصلوں کا ریکارڈ منظم کریں'
              : 'Manage your farm details and preferences'}
          </p>
        </div>
      </header>

      <main className="px-4 sm:px-5 mt-4 space-y-4">
        {/* Simple & Clean Farmer Card */}
        <section className="rounded-2xl bg-gradient-to-br from-[#062409] via-olive-dark to-[#062409] text-white p-4 shadow-lg border border-wheat/30 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
            <span className="text-[11px] font-bold tracking-wider uppercase text-wheat">
              {locale === 'ur' ? 'زرخیز کسان کارڈ' : 'Zarkhez Farmer Card'}
            </span>
            <bdi
              dir="ltr"
              className="px-2.5 py-0.5 rounded-full bg-wheat text-ink font-mono font-black text-xs shadow-sm"
            >
              {profile.farmerId || 'ZRK-PK-000000'}
            </bdi>
          </div>

          <div className="flex items-center gap-3">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt=""
                className="w-14 h-14 rounded-full object-cover border-2 border-wheat flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-cream text-olive-dark font-black text-lg flex items-center justify-center border-2 border-wheat flex-shrink-0">
                {initials || 'ZK'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-black text-lg text-white truncate">
                {fullName || profile.fullName || (locale === 'ur' ? 'کسان بھائی' : 'Farmer')}
              </h2>
              {fatherOrFarmName && (
                <p className="text-xs text-cream/80 truncate mt-0.5">{fatherOrFarmName}</p>
              )}
              <p className="text-[11px] text-white/70 flex items-center gap-1 mt-1 truncate">
                <MapPin className="w-3.5 h-3.5 text-wheat flex-shrink-0" />
                <span>{villageOrTehsil ? `${villageOrTehsil} • ${placeName}` : placeName}</span>
              </p>
            </div>
          </div>
        </section>

        {/* Simple Farm Form */}
        <form onSubmit={handleSaveProfile} className="bg-white rounded-2xl p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3.5">
          <h3 className="font-extrabold text-sm sm:text-base text-ink">
            {locale === 'ur' ? 'ذاتی و زرعی تفصیلات' : 'Personal & Farm Details'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'کسان کا نام' : 'Full Name'} *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={locale === 'ur' ? 'مثلاً محمد اکرم' : 'e.g. Muhammad Akram'}
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'والدیت یا فارم کا نام' : "Father's or Farm Name"}
              </label>
              <input
                type="text"
                value={fatherOrFarmName}
                onChange={(e) => setFatherOrFarmName(e.target.value)}
                placeholder={locale === 'ur' ? 'مثلاً النور فارم' : 'e.g. Al-Noor Farm'}
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'موبائل نمبر' : 'Phone Number'}
              </label>
              <input
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0300-1234567"
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'زرعی رقبہ (ایکڑ)' : 'Cultivated Area (Acres)'}
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                dir="ltr"
                value={totalAcres}
                onChange={(e) => setTotalAcres(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'گاؤں یا چک نمبر' : 'Village / Tehsil'}
              </label>
              <input
                type="text"
                value={villageOrTehsil}
                onChange={(e) => setVillageOrTehsil(e.target.value)}
                placeholder={locale === 'ur' ? 'مثلاً چک 45/12-L' : 'e.g. Village 45/12-L'}
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1">
                {locale === 'ur' ? 'ضلع' : 'District'}
              </label>
              <input
                type="text"
                value={placeName}
                onChange={(e) => setPlaceName(e.target.value)}
                placeholder="Faisalabad, Punjab"
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
              />
            </div>
          </div>

          {/* Crops Multi-Select */}
          <div>
            <label className="block text-xs font-bold text-ink/75 mb-1.5 flex items-center gap-1.5">
              <Sprout className="w-3.5 h-3.5 text-olive" />
              <span>{locale === 'ur' ? 'اہم فصلیں' : 'Primary Crops'}</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {crops.map((c) => {
                const active = selectedCrops.includes(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleCrop(c.key)}
                    className={`min-h-[42px] px-2 rounded-xl text-xs font-bold transition-all ${
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

          {/* Simple Voice Preferences */}
          <div className="p-3 rounded-xl bg-canvas border border-olive/15 space-y-2.5">
            <span className="block text-xs font-bold text-ink">
              {locale === 'ur' ? 'اردو آواز کی ترتیبات' : 'Urdu Voice Settings'}
            </span>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPreferredVoice('ur-PK-UzmaNeural')}
                className={`min-h-[42px] p-2 rounded-xl text-xs font-bold transition-all border ${
                  preferredVoice === 'ur-PK-UzmaNeural'
                    ? 'bg-olive text-white border-olive shadow-sm'
                    : 'bg-white text-ink border-olive/20'
                }`}
              >
                {t('femaleVoice')}
              </button>
              <button
                type="button"
                onClick={() => setPreferredVoice('ur-PK-AsadNeural')}
                className={`min-h-[42px] p-2 rounded-xl text-xs font-bold transition-all border ${
                  preferredVoice === 'ur-PK-AsadNeural'
                    ? 'bg-olive text-white border-olive shadow-sm'
                    : 'bg-white text-ink border-olive/20'
                }`}
              >
                {t('maleVoice')}
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] font-bold text-ink/70">
                {t('voiceSpeedLabel')}:
              </span>
              <div className="flex gap-1.5">
                {[0.85, 1.0, 1.15].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setVoiceSpeed(s)}
                    className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                      voiceSpeed === s
                        ? 'bg-olive text-white'
                        : 'bg-white text-ink/75 border border-olive/20'
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between gap-2 pt-1 cursor-pointer">
              <span className="text-xs font-bold text-ink/85">
                {t('autoSpeakLabel')}
              </span>
              <input
                type="checkbox"
                checked={autoSpeakVoice}
                onChange={(e) => setAutoSpeakVoice(e.target.checked)}
                className="w-4 h-4 accent-olive rounded"
              />
            </label>
          </div>

          {savedNotice && (
            <div className="p-3 rounded-xl bg-olive/15 text-olive-dark text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{locale === 'ur' ? 'پروفائل کامیابی سے محفوظ ہو گئی ہے' : 'Profile saved successfully!'}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full min-h-[50px] rounded-xl bg-olive hover:bg-olive-dark text-white font-black text-sm shadow-soft flex items-center justify-center gap-2 transition-all active:scale-98"
          >
            <Sparkles className="w-4 h-4" />
            <span>{locale === 'ur' ? 'معلومات محفوظ کریں' : 'Save Details'}</span>
          </button>
        </form>

        {/* Simple Bottom Actions: Back, Sign Out, Delete Data */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/home')}
              className="flex-1 min-h-[46px] rounded-xl bg-white border border-olive/20 text-ink font-bold text-xs"
            >
              {tApp('back')}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center justify-center gap-1.5 min-h-[46px] px-5 rounded-xl bg-alert-red/10 text-alert-red font-bold text-xs"
            >
              <LogOut className="w-4 h-4" />
              <span>{t('signOutBtn')}</span>
            </button>
          </div>

          <div className="text-center pt-1">
            {deletedNotice && (
              <p className="text-xs font-bold text-olive-dark mb-2">
                {tApp('deleteConfirm')}
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-alert-red/80 hover:text-alert-red hover:underline"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{tApp('deleteMyData')}</span>
            </button>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/75 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-card bg-white p-5 space-y-4 text-start shadow-2xl border border-alert-red/20">
              <div className="w-12 h-12 rounded-full bg-alert-red/10 flex items-center justify-center text-alert-red">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-extrabold text-base text-ink">
                  {locale === 'ur'
                    ? 'کیا آپ واقعی تمام ڈیٹا حذف کرنا چاہتے ہیں؟'
                    : 'Permanently Delete All Your Data?'}
                </h3>
                <p className="text-xs text-ink/70 leading-relaxed">
                  {locale === 'ur'
                    ? 'اس عمل سے آپ کے تمام سکین، تصاویر، کھیت، ڈائری اور اکاؤنٹ مستقل طور پر مٹ جائیں گے۔ یہ عمل واپس نہیں کیا جا سکتا۔'
                    : 'This will erase all your scans, leaf photos, fields, diary records, and account data forever. This cannot be undone.'}
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 min-h-[44px] rounded-full bg-canvas text-ink font-bold text-xs"
                >
                  {tApp('cancel')}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDeleteAll}
                  className="flex-1 min-h-[44px] rounded-full bg-alert-red text-white font-extrabold text-xs shadow-soft"
                >
                  {deleting ? '...' : locale === 'ur' ? 'ہاں، حذف کریں' : 'Yes, Delete All'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
