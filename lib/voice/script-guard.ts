import type { VoiceLang, VoiceLocaleCode, VoiceProviderId } from './types';
import { VOICE_LOCALE_MAP } from './types';

/**
 * Distinct Sindhi Perso-Arabic letters that MUST NOT be replaced with Urdu (ک ی ہ)
 * or Arabic approximations:
 * ڀ ٻ ڄ ڃ ڇ ڏ ڊ ڌ ڍ ڙ ڦ ڪ ڳ ڱ ڻ ٿ ٺ ٽ + Sindhi final/medial forms ي & ه
 */
export const SINDHI_SPECIFIC_CHARS = [
  'ڀ', 'ٻ', 'ڄ', 'ڃ', 'ڇ', 'ڏ', 'ڊ', 'ڌ', 'ڍ',
  'ڙ', 'ڦ', 'ڪ', 'ڳ', 'ڱ', 'ڻ', 'ٿ', 'ٺ', 'ٽ',
  'ي', 'ه',
] as const;

export const SINDHI_DISTINCT_CONSONANT_REGEX = /[ڀٻڄڃڇڏڊڌڍڙڦڪڳڱڻٿٺٽ]/;

/**
 * Providers that explicitly DO NOT support native Sindhi (sd-PK) TTS.
 * Sending Sindhi text to these engines would force Urdu/Hindi/Arabic phoneme fallback
 * and produce broken pronunciation.
 */
const PROVIDERS_BLOCKED_FOR_SINDHI: ReadonlySet<VoiceProviderId> =
  new Set<VoiceProviderId>(['azure-neural']);

export function containsSindhiLetters(text: string): boolean {
  if (!text) return false;
  return SINDHI_DISTINCT_CONSONANT_REGEX.test(text);
}

/**
 * Normalizes invisible joiners / whitespace while strictly preserving
 * every Sindhi codepoint (never NFKC-collapsing ڪ -> ک or ي -> ی or ه -> ہ).
 */
export function cleanPreserveScript(text: string): string {
  return text
    .replace(/\u200B/g, '') // zero-width space only
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function assertSindhiLettersPreserved(
  inputText: string,
  outputText: string
): { valid: boolean; missingChars: string[] } {
  const missingChars: string[] = [];
  for (const ch of SINDHI_SPECIFIC_CHARS) {
    if (inputText.includes(ch) && !outputText.includes(ch)) {
      missingChars.push(ch);
    }
  }
  return {
    valid: missingChars.length === 0,
    missingChars,
  };
}

export function isProviderAllowedForLanguage(
  provider: VoiceProviderId,
  lang: VoiceLang
): boolean {
  if (lang === 'sd' && PROVIDERS_BLOCKED_FOR_SINDHI.has(provider)) {
    return false;
  }
  return true;
}

export function resolveExplicitLocale(lang: VoiceLang): VoiceLocaleCode {
  return VOICE_LOCALE_MAP[lang] || 'ur-PK';
}
