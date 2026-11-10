import lexiconData from '@/data/voice/pronunciation-lexicon.json';
import type { LexiconEntry, VoiceLang } from './types';

const BUNDLED_ENTRIES: LexiconEntry[] = (lexiconData?.entries || []) as LexiconEntry[];

export function getBundledLexiconEntries(): LexiconEntry[] {
  return BUNDLED_ENTRIES;
}

export function getLexiconReplacement(entry: LexiconEntry, lang: VoiceLang): string {
  if (lang === 'sd') return entry.spokenSd || entry.term;
  if (lang === 'ur') return entry.spokenUr || entry.term;
  return entry.spokenEn || entry.term;
}

export function getLexiconHintsForLang(lang: VoiceLang): string[] {
  const hints = new Set<string>();
  for (const entry of BUNDLED_ENTRIES) {
    hints.add(entry.term);
    if (lang === 'sd' && entry.spokenSd) hints.add(entry.spokenSd);
    if (lang === 'ur' && entry.spokenUr) hints.add(entry.spokenUr);
    if (lang === 'en' && entry.spokenEn) hints.add(entry.spokenEn);
  }
  return Array.from(hints);
}
