'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  CheckCircle2,
  MapPin,
  Phone,
  Mail,
  Sprout,
  Award,
  UserCheck,
} from 'lucide-react';
import { FarmerProfile } from '@/lib/supabase/client';
import { getAllCrops } from '@/lib/calendar';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';

interface FarmerPersonaCardProps {
  profile: FarmerProfile;
  compact?: boolean;
  onEditClick?: () => void;
}

export function GoogleLogoSvg({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

/**
 * Digital Zarkhez Farmer Persona ID Card (زرخیز ڈیجیٹل کسان کارڈ)
 * Displays the user's Google-verified identity, unique ZRK-PK-XXXXXX Persona ID,
 * personal details, village/district, land acreage, and primary crops.
 */
export function FarmerPersonaCard({
  profile,
  compact = false,
  onEditClick,
}: FarmerPersonaCardProps) {
  const t = useTranslations('auth');
  const locale = useLocale() as 'ur' | 'en';
  const allCrops = getAllCrops();

  const initials = (profile.fullName || 'Z K')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (compact) {
    return (
      <div
        onClick={onEditClick}
        className="cursor-pointer bg-gradient-to-r from-olive-dark via-olive to-olive-dark text-white rounded-card p-4 shadow-soft border border-wheat/40 flex items-center justify-between gap-3 transition-transform active:scale-98"
      >
        <div className="flex items-center gap-3 min-w-0">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.fullName}
              className="w-12 h-12 rounded-full object-cover border-2 border-wheat flex-shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-cream text-olive-dark font-extrabold text-base flex items-center justify-center border-2 border-wheat flex-shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-extrabold text-base text-white truncate">
                {profile.fullName}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-wheat text-ink text-[10px] font-extrabold">
                <bdi dir="ltr">{profile.farmerId}</bdi>
              </span>
            </div>
            <p className="text-xs text-cream/90 truncate mt-0.5">
              {profile.villageOrTehsil
                ? `${profile.villageOrTehsil} • ${profile.placeName}`
                : profile.placeName}
            </p>
          </div>
        </div>
        <UserCheck className="w-5 h-5 text-cream flex-shrink-0" />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-card bg-gradient-to-br from-olive-dark via-[#2E4614] to-ink text-white p-5 shadow-2xl border-2 border-wheat/45 space-y-4">
      {/* Subtle decorative gold circles */}
      <div
        className="absolute -top-16 -end-16 w-44 h-44 rounded-full bg-wheat/20 blur-2xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Card Header: Logo + Official Persona ID Pill */}
      <div className="relative z-10 flex items-center justify-between gap-2 pb-3 border-b border-white/15">
        <ZarkhezLogo size={32} lightText subtitle={t('personaCardTitle')} />
        <div className="text-end">
          <span className="block text-[10px] uppercase tracking-wider text-cream/75">
            {t('farmerIdLabel')}
          </span>
          <bdi
            dir="ltr"
            className="inline-block mt-0.5 px-3 py-1 rounded-full bg-wheat text-ink font-mono font-extrabold text-xs tracking-wider shadow-sm"
          >
            {profile.farmerId || 'ZRK-PK-000000'}
          </bdi>
        </div>
      </div>

      {/* Farmer Identity Row */}
      <div className="relative z-10 flex items-center gap-4">
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={profile.fullName}
            className="w-16 h-16 rounded-2xl object-cover border-2 border-wheat shadow-md flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-2xl bg-cream text-olive-dark font-extrabold text-xl flex items-center justify-center border-2 border-wheat shadow-md flex-shrink-0">
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-extrabold text-xl text-white truncate">
              {profile.fullName}
            </h3>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-olive-fresh/25 text-cream border border-olive-fresh/40">
              <CheckCircle2 className="w-3 h-3 text-olive-fresh" />
              {t('verifiedFarmer')}
            </span>
          </div>

          {profile.fatherOrFarmName && (
            <p className="text-xs text-cream/90 font-medium mt-0.5">
              {profile.fatherOrFarmName}
            </p>
          )}

          {profile.email && (
            <div className="inline-flex items-center gap-1.5 text-xs text-white/75 mt-1">
              <GoogleLogoSvg className="w-3.5 h-3.5" />
              <bdi dir="ltr">{profile.email}</bdi>
            </div>
          )}
        </div>
      </div>

      {/* Personal & Farm Details Grid */}
      <div className="relative z-10 grid grid-cols-2 gap-2.5 pt-2">
        <div className="bg-white/10 backdrop-blur-sm rounded-tile p-2.5">
          <span className="text-[11px] text-white/70 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-wheat" />
            {t('districtLabel')}
          </span>
          <span className="font-bold text-xs text-white block mt-0.5 truncate">
            {profile.villageOrTehsil
              ? `${profile.villageOrTehsil}, ${profile.placeName}`
              : profile.placeName}
          </span>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-tile p-2.5">
          <span className="text-[11px] text-white/70 flex items-center gap-1">
            <Phone className="w-3.5 h-3.5 text-wheat" />
            {t('phoneLabel')}
          </span>
          <bdi
            dir="ltr"
            className="font-bold text-xs text-white block mt-0.5 truncate"
          >
            {profile.phone || '—'}
          </bdi>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-tile p-2.5">
          <span className="text-[11px] text-white/70 flex items-center gap-1">
            <Award className="w-3.5 h-3.5 text-wheat" />
            {t('totalAcresLabel')}
          </span>
          <bdi dir="ltr" className="font-extrabold text-sm text-cream block mt-0.5">
            {profile.totalAcres || 0} Acres
          </bdi>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-tile p-2.5">
          <span className="text-[11px] text-white/70 flex items-center gap-1">
            <Sprout className="w-3.5 h-3.5 text-olive-fresh" />
            {t('primaryCropsLabel')}
          </span>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {(profile.primaryCrops || ['wheat']).map((ck) => {
              const found = allCrops.find((c) => c.key === ck);
              return (
                <span
                  key={ck}
                  className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-olive-fresh/30 text-white"
                >
                  {found ? found.name[locale] : ck}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Verification Barcode Strip */}
      <div className="relative z-10 pt-3 border-t border-white/15 flex items-center justify-between text-[11px] text-white/70">
        <span>
          {t('memberSince')}: <bdi dir="ltr">{profile.joinedAt || '2026'}</bdi>
        </span>
        <div
          dir="ltr"
          className="font-mono tracking-widest text-[10px] text-cream/85"
        >
          |||| || ||| |||| {profile.farmerId}
        </div>
      </div>
    </div>
  );
}
