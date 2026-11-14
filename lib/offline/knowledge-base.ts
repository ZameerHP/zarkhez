'use client';

import rawGuides from '@/data/offline-guides.json';
import { idbGet, idbGetAll, idbPut, idbPutBatch, OFFLINE_STORES } from './db';

const GUIDE_BUNDLE_META_KEY = 'kb_guides_bundle_version';
export const GUIDE_BUNDLE_VERSION = `2026.11.v3:${(rawGuides as unknown[]).length}`;
export const MIN_GUIDE_RELEVANCE_SCORE = 5;

export type GuideCategory =
  | 'cultivation'
  | 'diseases'
  | 'fertilizer'
  | 'pests'
  | 'irrigation'
  | 'soil'
  | 'sowing_harvest'
  | 'safety';

export interface OfflineGuideItem {
  id: string;
  category: GuideCategory;
  cropKey: string;
  tags: string[];
  title: {
    en: string;
    ur: string;
    sd?: string;
  };
  summary: {
    en: string;
    ur: string;
    sd?: string;
  };
  steps: {
    en: string[];
    ur: string[];
    sd?: string[];
  };
  source: string;
  updatedAt?: number;
}

const BUNDLED_GUIDES = rawGuides as OfflineGuideItem[];

export function getBundledFarmingGuides(): OfflineGuideItem[] {
  return BUNDLED_GUIDES;
}

/**
 * Persists curated offline farming guides into IndexedDB for fast offline indexing & verification.
 */
export async function syncGuidesToOfflineDb(): Promise<number> {
  const now = Date.now();
  const records = BUNDLED_GUIDES.map((guide) => ({
    ...guide,
    updatedAt: now,
  }));
  const written = await idbPutBatch(OFFLINE_STORES.FARMING_GUIDES, records);
  await idbPut(OFFLINE_STORES.META, {
    id: GUIDE_BUNDLE_META_KEY,
    value: GUIDE_BUNDLE_VERSION,
    updatedAt: now,
  });
  return written;
}

export async function getAvailableOfflineGuides(): Promise<OfflineGuideItem[]> {
  try {
    const [stored, meta] = await Promise.all([
      idbGetAll<OfflineGuideItem>(OFFLINE_STORES.FARMING_GUIDES),
      idbGet<{ id: string; value?: string }>(OFFLINE_STORES.META, GUIDE_BUNDLE_META_KEY),
    ]);
    if (stored.length >= BUNDLED_GUIDES.length && meta?.value === GUIDE_BUNDLE_VERSION) {
      return stored;
    }
    if (typeof indexedDB !== 'undefined') {
      void syncGuidesToOfflineDb().catch(() => {});
    }
  } catch {
    // fallback to bundled static JSON seamlessly
  }
  return BUNDLED_GUIDES;
}

const STOP_WORDS = new Set([
  'the',
  'is',
  'a',
  'an',
  'in',
  'on',
  'for',
  'to',
  'of',
  'my',
  'and',
  'or',
  'how',
  'what',
  'when',
  'why',
  'can',
  'please',
  'me',
  'give',
  'tell',
  'about',
  'hai',
  'hain',
  'ka',
  'ki',
  'ke',
  'ko',
  'mein',
  'me',
  'se',
  'aur',
  'kya',
  'kab',
  'kaise',
  'kitna',
  'kitni',
  'batao',
  'deni',
  'chahiye',
  'کیا',
  'کی',
  'کا',
  'کے',
  'کو',
  'میں',
  'سے',
  'ہے',
  'ہیں',
  'اور',
  'کب',
  'کیسے',
  'بتائیں',
  'جي',
  'جو',
  'جا',
  'کي',
  '۾',
  '۽',
  'آهي',
  'آهن',
  'ڪڏهن',
  'ڪيئن',
  'ڇا',
]);

const KB_SYNONYMS: Record<string, string[]> = {
  gandum: ['wheat', 'گندم', 'ڪڻڪ'],
  گندم: ['wheat'],
  ڪڻڪ: ['wheat'],
  chawal: ['rice', 'paddy', 'چاول', 'دھان'],
  dhan: ['rice', 'paddy'],
  چاول: ['rice', 'paddy'],
  دھان: ['rice', 'paddy'],
  ساريون: ['rice', 'paddy'],
  kapas: ['cotton', 'کپاس', 'وونئڻ'],
  کپاس: ['cotton'],
  وونئڻ: ['cotton'],
  ganna: ['sugarcane', 'کماد'],
  kamad: ['sugarcane'],
  کماد: ['sugarcane'],
  ڪمند: ['sugarcane'],
  makai: ['maize', 'corn'],
  مکئی: ['maize'],
  مڪئي: ['maize'],
  tamatar: ['tomato'],
  ٹماٹر: ['tomato'],
  ٽماٽر: ['tomato'],
  mirch: ['chili', 'pepper'],
  مرچ: ['chili'],
  مرچون: ['chili'],
  pani: ['irrigation', 'water', 'آبپاشی', 'پانی', 'پاڻي'],
  irrigate: ['irrigation', 'watering'],
  آبپاشی: ['irrigation'],
  پانی: ['irrigation'],
  پاڻي: ['irrigation'],
  khad: ['fertilizer', 'urea', 'dap', 'کھاد', 'ڀاڻ'],
  bhaan: ['fertilizer'],
  کھاد: ['fertilizer'],
  ڀاڻ: ['fertilizer'],
  keera: ['pest', 'insect', 'کیڑا'],
  کیڑے: ['pest'],
  جيت: ['pest'],
  kallar: ['salinity', 'gypsum', 'soil'],
  کلر: ['salinity', 'gypsum', 'soil'],
  ڪلر: ['salinity', 'gypsum', 'soil'],
  spray: ['safety', 'pesticide', 'اسپرے'],
  اسپرے: ['safety', 'spray'],
  اسپري: ['safety', 'spray'],
  scheme: ['kissan', 'subsidy', 'اسکیم', 'اسڪيم'],
};

/**
 * Normalizes Urdu/Arabic/Sindhi diacritics and character variants so script drift
 * (e.g. ي vs ی, ه vs ہ, آ vs ا, tashkeel) still matches offline search accurately.
 */
export function normalizeIndicArabicText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/[يئ]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةه]/g, 'ہ');
}

export function tokenizeMultilingualQuery(
  input: string,
  extraStopWords?: Set<string>
): { rawTokens: string[]; expandedTokens: string[] } {
  const normalized = normalizeIndicArabicText(input);
  const rawTokens = normalized
    .replace(/[۔.!?؟،,؛;:()\[\]{}"'`/\\]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length >= 2 &&
        !STOP_WORDS.has(t) &&
        !(extraStopWords && extraStopWords.has(t))
    );

  const expandedSet = new Set<string>(rawTokens);
  for (const tok of rawTokens) {
    const syns = KB_SYNONYMS[tok];
    if (syns) {
      for (const s of syns) expandedSet.add(normalizeIndicArabicText(s));
    }
  }

  return { rawTokens, expandedTokens: Array.from(expandedSet) };
}

interface IndexedGuideCorpus {
  normalizedTags: string[];
  tagsJoined: string;
  titleJoined: string;
  bodyJoined: string;
}

const guideIndexCache = new WeakMap<OfflineGuideItem, IndexedGuideCorpus>();

function getGuideCorpus(guide: OfflineGuideItem): IndexedGuideCorpus {
  const cached = guideIndexCache.get(guide);
  if (cached) return cached;

  const normalizedTags = guide.tags.map((tag) => normalizeIndicArabicText(tag));
  const corpus: IndexedGuideCorpus = {
    normalizedTags,
    tagsJoined: normalizedTags.join(' '),
    titleJoined: normalizeIndicArabicText(
      `${guide.title.en} ${guide.title.ur} ${guide.title.sd || ''} ${guide.cropKey}`
    ),
    bodyJoined: normalizeIndicArabicText(
      `${guide.summary.en} ${guide.summary.ur} ${guide.summary.sd || ''} ${guide.steps.en.join(' ')} ${guide.steps.ur.join(' ')} ${(guide.steps.sd || []).join(' ')}`
    ),
  };
  guideIndexCache.set(guide, corpus);
  return corpus;
}

export interface GuideMatchResult {
  guide: OfflineGuideItem;
  score: number;
}

export function searchOfflineGuides(
  query: string,
  guides: OfflineGuideItem[] = BUNDLED_GUIDES,
  limit = 3
): GuideMatchResult[] {
  const { expandedTokens } = tokenizeMultilingualQuery(query);
  if (expandedTokens.length === 0) return [];

  const scored: GuideMatchResult[] = [];
  for (const guide of guides) {
    const corpus = getGuideCorpus(guide);
    let score = 0;
    let matchedTokens = 0;

    for (const token of expandedTokens) {
      let tokenMatched = false;
      if (corpus.normalizedTags.some((tag) => tag === token)) {
        score += 10;
        tokenMatched = true;
      } else if (corpus.tagsJoined.includes(token)) {
        score += 6;
        tokenMatched = true;
      }
      if (corpus.titleJoined.includes(token)) {
        score += 5;
        tokenMatched = true;
      } else if (corpus.bodyJoined.includes(token)) {
        score += 2;
        tokenMatched = true;
      }
      if (tokenMatched) matchedTokens++;
    }

    if (score >= MIN_GUIDE_RELEVANCE_SCORE || (matchedTokens >= 2 && score >= 4)) {
      scored.push({ guide, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
