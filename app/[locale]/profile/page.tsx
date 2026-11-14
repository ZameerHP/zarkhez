'use client';

import React, { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import {
  ArrowLeft,
  CheckCircle2,
  LogOut,
  Sparkles,
  Trash2,
  MapPin,
  Sprout,
  UserCheck,
  ShieldCheck,
  ChevronRight,
  X,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { LocationPickerModal } from '@/components/weather/LocationPickerModal';
import { InstallAppCard } from '@/components/pwa/InstallApp';
import {
  arePersonalFieldsComplete,
  deleteAllUserData,
  FarmerProfile,
  generateFarmerPersonaId,
  getSavedProfile,
  restorePersistentSession,
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
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lon, setLon] = useState<number | undefined>(undefined);
  const [totalAcres, setTotalAcres] = useState('5');
  const [selectedCrops, setSelectedCrops] = useState<string[]>(['wheat']);

  const [editingPersonalInfo, setEditingPersonalInfo] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hydrateFieldsFromProfile = (p: FarmerProfile) => {
    setProfile(p);
    setFullName(p.fullName || '');
    setFatherOrFarmName(p.fatherOrFarmName || '');
    setPhone(p.phone || '');
    setVillageOrTehsil(p.villageOrTehsil || '');
    setPlaceName(p.placeName || 'Faisalabad, Punjab');
    setLat(p.lat);
    setLon(p.lon);
    setTotalAcres(String(p.totalAcres > 0 ? p.totalAcres : ''));
    setSelectedCrops(p.primaryCrops?.length ? p.primaryCrops : ['wheat']);
  };

  useEffect(() => {
    const p = getSavedProfile();
    hydrateFieldsFromProfile(p);

    restorePersistentSession().then((restored) => {
      if (restored) {
        hydrateFieldsFromProfile(restored);
      }
    });

    syncSupabaseAuthSession().then((synced) => {
      if (synced) {
        hydrateFieldsFromProfile(synced);
      }
    });
  }, []);

  const isPersonalInfoComplete = arePersonalFieldsComplete(profile);

  const toggleCrop = (cropKey: string) => {
    setSelectedCrops((prev) =>
      prev.includes(cropKey)
        ? prev.length > 1
          ? prev.filter((k) => k !== cropKey)
          : prev
        : [...prev, cropKey]
    );
  };

  const handleSavePersonalDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const farmerId =
      profile.farmerId ||
      generateFarmerPersonaId(phone || fullName || String(Date.now()));

    const updated = await saveProfile({
      ...profile,
      farmerId,
      fullName:
        fullName.trim() || (locale === 'ur' ? 'کسان بھائی' : 'Farmer Friend'),
      fatherOrFarmName: fatherOrFarmName.trim(),
      phone: phone.trim(),
      villageOrTehsil: villageOrTehsil.trim(),
      placeName: placeName.trim() || 'Faisalabad, Punjab',
      district: placeName.split(',')[0].trim(),
      ...(typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : {}),
      totalAcres: Math.max(0.5, parseFloat(totalAcres) || 1),
      primaryCrops: selectedCrops,
      mainCrops: selectedCrops,
      language: locale,
      onboardingDone: true,
    });

    hydrateFieldsFromProfile(updated);
    setSaving(false);
    setEditingPersonalInfo(false);
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

  const showFieldsForm = !isPersonalInfoComplete || editingPersonalInfo;

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
              ? 'آپ کا اکاؤنٹ اور ذاتی معلومات کلاؤڈ ڈیٹابیس میں محفوظ ہیں'
              : 'Your account & farm details stay securely synced to cloud database'}
          </p>
        </div>
      </header>

      <main className="px-4 sm:px-5 mt-4 space-y-4">
        {/* Clean Minimal Identity Summary (Never exposes personal info fields when saved) */}
        <section className="rounded-2xl bg-gradient-to-br from-[#062409] via-olive-dark to-[#062409] text-white p-4 shadow-lg border border-wheat/30">
          <div className="flex items-center gap-3.5">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={profile.fullName || 'Farmer'}
                className="w-14 h-14 rounded-full object-cover border-2 border-wheat flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-cream text-olive-dark font-black text-lg flex items-center justify-center border-2 border-wheat flex-shrink-0">
                {initials || 'ZK'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-black text-lg text-white truncate">
                {profile.fullName ||
                  fullName ||
                  (locale === 'ur' ? 'کسان بھائی' : 'Farmer')}
              </h2>
              <span className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-400/35 text-emerald-200 text-[11px] font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                <span>
                  {locale === 'ur'
                    ? 'ڈیٹابیس سے محفوظ منسلک'
                    : 'Synced to Database'}
                </span>
              </span>
            </div>
          </div>
        </section>

        {savedNotice && (
          <div className="p-3 rounded-xl bg-olive/15 text-olive-dark text-xs font-bold flex items-center gap-2 border border-olive/25">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>
              {locale === 'ur'
                ? 'پروفائل کامیابی سے ڈیٹابیس میں محفوظ ہو گئی ہے'
                : 'Profile saved and synced to database!'}
            </span>
          </div>
        )}

        {/* When all fields are filled and not editing: Show ONLY a clean Personal Info Button */}
        {isPersonalInfoComplete && !editingPersonalInfo && (
          <button
            type="button"
            onClick={() => setEditingPersonalInfo(true)}
            className="w-full bg-white hover:bg-olive/5 rounded-2xl p-4 shadow-soft border border-olive/20 hover:border-olive transition-all flex items-center justify-between gap-3 text-start active:scale-[0.98]"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-olive/12 text-olive-dark flex items-center justify-center flex-shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="block font-extrabold text-sm sm:text-base text-ink">
                  {locale === 'ur' ? 'ذاتی معلومات' : 'Personal Info'}
                </span>
                <span className="block text-xs text-ink/65 mt-0.5">
                  {locale === 'ur'
                    ? 'محفوظ شدہ تفصیلات دیکھنے یا تبدیل کرنے کے لیے کلک کریں'
                    : 'Tap to view or update your personal details'}
                </span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-olive rtl:rotate-180 flex-shrink-0" />
          </button>
        )}

        {/* Personal & Farm Form: visible ONLY until all fields are filled OR when Personal Info button is clicked */}
        {showFieldsForm && (
          <form
            onSubmit={handleSavePersonalDetails}
            className="bg-white rounded-2xl p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-extrabold text-sm sm:text-base text-ink">
                {locale === 'ur' ? 'ذاتی و زرعی تفصیلات' : 'Personal Info'}
              </h3>
              {isPersonalInfoComplete && editingPersonalInfo && (
                <button
                  type="button"
                  onClick={() => {
                    hydrateFieldsFromProfile(profile);
                    setEditingPersonalInfo(false);
                  }}
                  className="inline-flex items-center gap-1 min-h-[40px] px-3 py-1 rounded-full bg-canvas text-xs font-bold text-ink/70 hover:text-ink"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{tApp('cancel')}</span>
                </button>
              )}
            </div>

            {!isPersonalInfoComplete && (
              <p className="text-[11px] text-olive-dark bg-olive/10 px-3 py-2 rounded-xl font-semibold">
                {locale === 'ur'
                  ? 'تمام خانے پُر کر کے محفوظ کریں — اس کے بعد آپ کی ذاتی معلومات محفوظ ہو کر اسکرین سے چھپ جائیں گی۔'
                  : 'Complete all fields below and save — once saved, your personal info stays hidden behind the Personal Info button.'}
              </p>
            )}

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
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-base sm:text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">
                  {locale === 'ur' ? 'والدیت یا فارم کا نام' : "Father's or Farm Name"} *
                </label>
                <input
                  type="text"
                  required
                  value={fatherOrFarmName}
                  onChange={(e) => setFatherOrFarmName(e.target.value)}
                  placeholder={locale === 'ur' ? 'مثلاً النور فارم' : 'e.g. Al-Noor Farm'}
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-base sm:text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">
                  {locale === 'ur' ? 'موبائل نمبر' : 'Phone Number'} *
                </label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0300-1234567"
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-base sm:text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">
                  {locale === 'ur' ? 'زرعی رقبہ (ایکڑ)' : 'Cultivated Area (Acres)'} *
                </label>
                <input
                  type="number"
                  required
                  min="0.5"
                  step="0.5"
                  dir="ltr"
                  value={totalAcres}
                  onChange={(e) => setTotalAcres(e.target.value)}
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-base sm:text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">
                  {locale === 'ur' ? 'گاؤں یا چک نمبر' : 'Village / Tehsil'} *
                </label>
                <input
                  type="text"
                  required
                  value={villageOrTehsil}
                  onChange={(e) => setVillageOrTehsil(e.target.value)}
                  placeholder={locale === 'ur' ? 'مثلاً چک 45/12-L' : 'e.g. Village 45/12-L'}
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-base sm:text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">
                  {locale === 'ur' ? 'ضلع / شہر' : 'District / City'} *
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    required
                    value={placeName}
                    onChange={(e) => setPlaceName(e.target.value)}
                    placeholder="Mirpur Khas, Sindh"
                    className="flex-1 min-w-0 min-h-[46px] px-3.5 rounded-xl bg-canvas border border-olive/25 text-base sm:text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-olive"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCityPicker(true)}
                    className="min-h-[46px] px-3 rounded-xl bg-olive/12 text-olive-dark hover:bg-olive/20 flex items-center justify-center flex-shrink-0"
                    aria-label={locale === 'ur' ? 'شہر منتخب کریں' : 'Choose City'}
                  >
                    <MapPin className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Crops Multi-Select */}
            <div>
              <label className="block text-xs font-bold text-ink/75 mb-1.5 flex items-center gap-1.5">
                <Sprout className="w-3.5 h-3.5 text-olive" />
                <span>{locale === 'ur' ? 'اہم فصلیں' : 'Primary Crops'} *</span>
              </label>
              <div className="grid grid-cols-2 min-[380px]:grid-cols-3 gap-2">
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

            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[50px] rounded-xl bg-olive hover:bg-olive-dark text-white font-black text-sm shadow-soft flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-60"
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {saving
                  ? locale === 'ur'
                    ? 'ڈیٹابیس میں محفوظ ہو رہا ہے...'
                    : 'Saving to database...'
                  : locale === 'ur'
                  ? 'معلومات محفوظ کریں'
                  : 'Save Personal Info'}
              </span>
            </button>
          </form>
        )}

        {/* Quick Access: Offline Center & Verified Govt Schemes */}
        <div className="grid grid-cols-2 gap-2.5">
          <Link
            href="/offline-center"
            className="rounded-2xl bg-white border border-olive/15 p-3.5 shadow-soft flex flex-col gap-1 hover:border-olive transition-all"
          >
            <span className="font-extrabold text-xs text-olive-dark">
              {locale === 'ur' ? 'آف لائن ڈاؤن لوڈ سینٹر' : 'Offline Downloads'}
            </span>
            <span className="text-[11px] text-ink/65 leading-snug">
              {locale === 'ur' ? 'ماڈلز، گائیڈز اور سنک' : 'ONNX AI, guides & sync'}
            </span>
          </Link>
          <Link
            href="/schemes"
            className="rounded-2xl bg-white border border-olive/15 p-3.5 shadow-soft flex flex-col gap-1 hover:border-olive transition-all"
          >
            <span className="font-extrabold text-xs text-olive-dark">
              {locale === 'ur' ? 'کسان سرکاری اسکیمیں' : 'Govt Schemes'}
            </span>
            <span className="text-[11px] text-ink/65 leading-snug">
              {locale === 'ur' ? 'تصدیق شدہ پورٹلز اور اہلیت' : 'Verified portals & aid'}
            </span>
          </Link>
        </div>

        {/* Install ZARKHEZ as an app (PWA) — hidden once installed */}
        <InstallAppCard />

        {/* Bottom Actions: Back, Sign Out, Delete Data */}
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

        {/* City Selector Modal inside Profile Editor (includes Mirpur Khas) */}
        <LocationPickerModal
          isOpen={showCityPicker}
          onClose={() => setShowCityPicker(false)}
          onSelectPlace={(nextPlace, nextLat, nextLon) => {
            setPlaceName(nextPlace);
            setLat(nextLat);
            setLon(nextLon);
            setShowCityPicker(false);
          }}
        />

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-ink/75 backdrop-blur-sm overflow-y-auto">
            <div className="w-full max-w-sm max-h-[90dvh] overflow-y-auto overscroll-contain rounded-card bg-white p-5 space-y-4 text-start shadow-2xl border border-alert-red/20">
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
