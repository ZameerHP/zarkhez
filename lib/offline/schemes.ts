'use client';

import rawSchemes from '@/data/schemes.json';
import { idbGet, idbGetAll, idbPut, idbPutBatch, OFFLINE_STORES } from './db';
import { normalizeIndicArabicText, tokenizeMultilingualQuery } from './knowledge-base';

const SCHEME_BUNDLE_META_KEY = 'schemes_bundle_version';
const SCHEME_BUNDLE_VERSION = `2026.11.v3:${(rawSchemes as unknown[]).length}`;

export type SchemeStatus = 'ongoing' | 'verify_on_portal' | 'expired';

export interface GovernmentSchemeItem {
  id: string;
  title: {
    en: string;
    ur: string;
    sd?: string;
  };
  province: string;
  department: string;
  officialPortal: string;
  helpline: string;
  status: SchemeStatus;
  lastVerifiedAt: string;
  datesNote: {
    en: string;
    ur: string;
  };
  summary: {
    en: string;
    ur: string;
    sd?: string;
  };
  eligibility: {
    en: string[];
    ur: string[];
  };
  documents: {
    en: string[];
    ur: string[];
  };
  steps: {
    en: string[];
    ur: string[];
  };
  verifiedBy: string;
  cachedAt?: number;
}

const BUNDLED_SCHEMES = rawSchemes as GovernmentSchemeItem[];

export function getBundledSchemes(): GovernmentSchemeItem[] {
  return BUNDLED_SCHEMES;
}

export async function syncSchemesToOfflineDb(): Promise<number> {
  const now = Date.now();
  const records = BUNDLED_SCHEMES.map((scheme) => ({
    ...scheme,
    cachedAt: now,
  }));
  const count = await idbPutBatch(OFFLINE_STORES.SCHEMES, records);
  await idbPut(OFFLINE_STORES.META, {
    id: SCHEME_BUNDLE_META_KEY,
    value: SCHEME_BUNDLE_VERSION,
    updatedAt: now,
  });
  return count;
}

export async function getAvailableSchemesOffline(): Promise<GovernmentSchemeItem[]> {
  try {
    const [stored, meta] = await Promise.all([
      idbGetAll<GovernmentSchemeItem>(OFFLINE_STORES.SCHEMES),
      idbGet<{ id: string; value?: string }>(OFFLINE_STORES.META, SCHEME_BUNDLE_META_KEY),
    ]);
    if (stored.length >= BUNDLED_SCHEMES.length && meta?.value === SCHEME_BUNDLE_VERSION) {
      return stored;
    }
    if (typeof indexedDB !== 'undefined') {
      void syncSchemesToOfflineDb().catch(() => {});
    }
  } catch {
    // fallback to bundled static JSON
  }
  return BUNDLED_SCHEMES;
}

export async function adminUpsertVerifiedScheme(
  scheme: GovernmentSchemeItem
): Promise<boolean> {
  return idbPut(OFFLINE_STORES.SCHEMES, {
    ...scheme,
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
    cachedAt: Date.now(),
  });
}

const SCHEME_STOPWORDS = new Set([
  'scheme',
  'schemes',
  'govt',
  'government',
  'program',
  'programme',
  'pakistan',
  'subsidy',
  'apply',
  'eligibility',
  'tell',
  'about',
  'what',
  'is',
  'the',
  'for',
  'in',
  'of',
  'and',
  'or',
  'how',
  'to',
]);

const SCHEME_SYNONYMS: Record<string, string[]> = {
  kisan: ['kissan', 'hari', 'کسان', 'ہاری', 'کسان'],
  kissan: ['kisan', 'hari', 'کسان'],
  hari: ['kissan', 'kisan', 'sindh', 'ہاری'],
  کسان: ['kissan', 'kisan'],
  ہاري: ['hari', 'sindh', 'kissan'],
  ہاری: ['hari', 'sindh', 'kissan'],
  solar: ['سولر', 'tubewell', 'شمسی'],
  سولر: ['solar', 'tubewell'],
  tubewell: ['solar', 'ٹیوب'],
  tractor: ['ٹریکٹر', 'ٽریکٹر', 'green'],
  ٹریکٹر: ['tractor'],
  ٽریکٹر: ['tractor'],
  loan: ['qarz', 'ztbl', 'قرض'],
  qarz: ['loan', 'ztbl', 'قرض'],
  قرض: ['loan', 'ztbl'],
};

export async function searchOfflineSchemes(
  query: string,
  provinceFilter?: string
): Promise<GovernmentSchemeItem[]> {
  const schemes = await getAvailableSchemesOffline();
  const provinceFiltered = schemes.filter((s) => {
    if (provinceFilter && provinceFilter !== 'all') {
      return s.province.toLowerCase().includes(provinceFilter.toLowerCase());
    }
    return true;
  });

  const q = normalizeIndicArabicText(query.trim());
  if (!q) return provinceFiltered;

  const { rawTokens, expandedTokens } = tokenizeMultilingualQuery(q, SCHEME_STOPWORDS);
  const rawNormalized = q
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9\u0600-\u06FF]/gi, ''))
    .filter((t) => t.length >= 2);
  const tokenSet = new Set<string>(expandedTokens.length > 0 ? expandedTokens : rawNormalized);
  for (const t of rawTokens) {
    const syns = SCHEME_SYNONYMS[t];
    if (syns) {
      for (const s of syns) tokenSet.add(normalizeIndicArabicText(s));
    }
  }
  const tokens = Array.from(tokenSet);

  const scored = provinceFiltered
    .map((s) => {
      const titleBlob = normalizeIndicArabicText(
        `${s.title.en} ${s.title.ur} ${s.title.sd || ''} ${s.province}`
      );
      const fullBlob = normalizeIndicArabicText(
        `${titleBlob} ${s.department} ${s.summary.en} ${s.summary.ur} ${s.summary.sd || ''}`
      );
      const exactMatch = fullBlob.includes(q);
      let hits = 0;
      let titleHits = 0;
      for (const token of tokens) {
        if (fullBlob.includes(token)) hits += 1;
        if (titleBlob.includes(token)) titleHits += 1;
      }
      return { scheme: s, exactMatch, hits, titleHits };
    })
    .filter((entry) => entry.exactMatch || entry.hits > 0);

  const minRequiredHits = rawTokens.length >= 2 ? 2 : 1;
  const strongMatches = scored.filter(
    (entry) => entry.exactMatch || entry.hits >= minRequiredHits
  );
  const selected = strongMatches.length > 0 ? strongMatches : scored;

  selected.sort((a, b) => {
    if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1;
    const scoreA = a.titleHits * 3 + a.hits;
    const scoreB = b.titleHits * 3 + a.hits;
    return scoreB - scoreA;
  });

  return selected.map((entry) => entry.scheme);
}
