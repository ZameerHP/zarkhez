'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  Landmark,
  Phone,
  Search,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { OfflineStatusChip } from '@/components/offline/OfflineStatusChip';
import {
  getAvailableSchemesOffline,
  syncSchemesToOfflineDb,
  type GovernmentSchemeItem,
} from '@/lib/offline/schemes';

const PROVINCES = ['all', 'Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'National'] as const;

export default function SchemesPage() {
  const locale = useLocale() as 'en' | 'ur';
  const [schemes, setSchemes] = useState<GovernmentSchemeItem[]>([]);
  const [province, setProvince] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    void syncSchemesToOfflineDb();
    getAvailableSchemesOffline()
      .then(setSchemes)
      .catch(() => undefined);
  }, []);

  const filtered = schemes.filter((item) => {
    if (province !== 'all' && !item.province.toLowerCase().includes(province.toLowerCase())) {
      return false;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const blob = `${item.title.en} ${item.title.ur} ${item.province} ${item.department} ${item.summary.en} ${item.summary.ur}`.toLowerCase();
    return blob.includes(q);
  });

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas overflow-x-hidden">
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[28px] px-4 sm:px-5 pt-4 pb-6 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href="/home"
              className="w-10 h-10 rounded-full glass flex items-center justify-center text-white"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={32} lightText showText={false} />
          </div>
          <div className="flex items-center gap-1.5">
            <OfflineStatusChip compact variant="glass" />
            <LanguageToggle variant="glass" />
          </div>
        </div>

        <div className="mt-3.5">
          <h1 className="font-extrabold text-xl text-white flex items-center gap-2">
            <Landmark className="w-5 h-5 text-emerald-300 flex-shrink-0" />
            <span>
              {locale === 'ur'
                ? 'تصدیق شدہ سرکاری کسان اسکیمیں'
                : 'Verified Farmer Govt Schemes'}
            </span>
          </h1>
          <p className="text-xs text-cream/90 mt-0.5 leading-snug">
            {locale === 'ur'
              ? 'صرف آفیشل .gov.pk پورٹلز اور مستند شرائط — مکمل آف لائن دستیاب'
              : 'Official .gov.pk portals, eligibility rules & documents — cached for offline viewing'}
          </p>
        </div>
      </header>

      <main className="px-3.5 sm:px-5 mt-4 space-y-4 max-w-md mx-auto">
        {/* Search & Province Filter */}
        <section className="bg-white rounded-card p-3.5 shadow-soft border border-olive/15 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-ink/50 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                locale === 'ur'
                  ? 'کسان کارڈ، ٹریکٹر، سولر تلاش کریں...'
                  : 'Search Kissan Card, Tractor, Solar...'
              }
              className="w-full min-h-[44px] ps-9 pe-3 rounded-xl bg-canvas border border-olive/20 text-xs font-semibold text-ink focus:outline-none focus:border-olive"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {PROVINCES.map((prov) => (
              <button
                key={prov}
                type="button"
                onClick={() => setProvince(prov)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold whitespace-nowrap transition-all ${
                  province === prov
                    ? 'bg-[#062409] text-white'
                    : 'bg-canvas text-ink/75 border border-olive/15'
                }`}
              >
                {prov === 'all'
                  ? locale === 'ur'
                    ? 'تمام'
                    : 'All Regions'
                  : prov}
              </button>
            ))}
          </div>
        </section>

        {/* Schemes List */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-card p-6 text-center text-xs font-bold text-ink/60 border border-olive/10">
            {locale === 'ur'
              ? 'کوئی متعلقہ سرکاری اسکیم نہیں ملی۔'
              : 'No matching schemes found in this region.'}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((scheme) => (
              <article
                key={scheme.id}
                className="bg-white rounded-card p-4 sm:p-5 shadow-soft border border-olive/15 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-olive/12 text-olive-dark text-[10px] font-extrabold">
                        {scheme.province}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold inline-flex items-center gap-1 ${
                          scheme.status === 'ongoing'
                            ? 'bg-emerald-500/15 text-olive-dark'
                            : 'bg-amber-500/15 text-amber-900'
                        }`}
                      >
                        {scheme.status === 'ongoing' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        {scheme.status === 'ongoing'
                          ? locale === 'ur'
                            ? 'جاری اسکیم'
                            : 'Ongoing'
                          : locale === 'ur'
                          ? 'فیز تاریخ پورٹل پر چیک کریں'
                          : 'Verify Active Phase on Portal'}
                      </span>
                    </div>
                    <h2 className="font-extrabold text-base text-ink leading-snug">
                      {scheme.title[locale]}
                    </h2>
                    <p className="text-[11px] font-semibold text-ink/65">
                      {scheme.department}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-ink/85 leading-relaxed bg-canvas p-3 rounded-xl border border-olive/10">
                  {scheme.summary[locale]}
                </p>

                <div className="space-y-1.5">
                  <h3 className="font-extrabold text-xs text-olive-dark flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{locale === 'ur' ? 'اہلیت کی شرائط' : 'Eligibility Rules'}</span>
                  </h3>
                  <ul className="list-disc ps-4 space-y-1 text-xs text-ink/80">
                    {scheme.eligibility[locale].map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1.5">
                  <h3 className="font-extrabold text-xs text-olive-dark flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    <span>
                      {locale === 'ur' ? 'مطلوبہ دستاویزات اور طریقہ کار' : 'Documents & Application Steps'}
                    </span>
                  </h3>
                  <p className="text-[11px] text-ink/75">
                    <strong>{locale === 'ur' ? 'دستاویزات: ' : 'Docs: '}</strong>
                    {scheme.documents[locale].join(' • ')}
                  </p>
                  <ol className="list-decimal ps-4 space-y-1 text-xs text-ink/80">
                    {scheme.steps[locale].map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                </div>

                <p className="text-[11px] text-amber-900 bg-amber-500/10 rounded-xl px-3 py-2 border border-amber-500/25">
                  {scheme.datesNote[locale]}
                </p>

                <div className="pt-1 flex items-center justify-between gap-2 flex-wrap border-t border-olive/10 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-ink/70 font-semibold">
                    <Phone className="w-3 h-3 text-olive" />
                    <bdi dir="ltr">{scheme.helpline}</bdi>
                  </span>
                  <a
                    href={scheme.officialPortal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#062409] text-white font-bold text-[11px]"
                  >
                    <span>{locale === 'ur' ? 'آفیشل پورٹل' : 'Official Portal'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <p className="text-[10px] text-ink/50">
                  {locale === 'ur' ? 'آخری تصدیق:' : 'Verified:'} {scheme.lastVerifiedAt} •{' '}
                  {scheme.verifiedBy}
                </p>
              </article>
            ))}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
