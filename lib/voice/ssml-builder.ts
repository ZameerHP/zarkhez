import type { LexiconEntry, VoiceLang, VoiceSpeedMode } from './types';
import { resolveExplicitLocale } from './script-guard';
import { toSpokenText } from './spoken-normalizer';
import { getLexiconReplacement } from './lexicon-loader';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function resolveSpeakingRate(speedMode?: VoiceSpeedMode, numericSpeed?: number): number {
  if (typeof numericSpeed === 'number' && Number.isFinite(numericSpeed)) {
    return Math.min(1.25, Math.max(0.65, numericSpeed));
  }
  return speedMode === 'slow' ? 0.75 : 0.9;
}

/**
 * Generates W3C SSML 1.0 markup with explicit language tag, calm ~0.90 rate
 * (or ~0.75 slow repeat rate), short pauses between sentences, subtle pauses
 * around numeric/unit words, and <phoneme>/<sub alias> tags from the lexicon.
 */
export function buildVoiceSsml(params: {
  text: string;
  lang: VoiceLang;
  voiceName: string;
  speedMode?: VoiceSpeedMode;
  speedRate?: number;
  lexiconEntries?: LexiconEntry[];
}): string {
  const locale = resolveExplicitLocale(params.lang);
  const rate = resolveSpeakingRate(params.speedMode, params.speedRate);
  const ratePct = `${Math.round((rate - 1) * 100)}%`;

  const normalized = toSpokenText(params.text, params.lang, {
    lexiconEntries: params.lexiconEntries,
  });

  // Insert short pause cues around number/unit markers where applicable
  const sentenceNodes = normalized.sentences.map((sentence) => {
    let body = escapeXml(sentence);
    if (params.lexiconEntries) {
      for (const entry of params.lexiconEntries) {
        const spoken = getLexiconReplacement(entry, params.lang);
        const ipa = params.lang === 'sd' ? entry.ipaSd : entry.ipaUr;
        if (spoken && ipa && body.includes(escapeXml(spoken))) {
          const safeSpoken = escapeXml(spoken);
          body = body.replace(
            safeSpoken,
            `<phoneme alphabet="ipa" ph="${escapeXml(ipa)}">${safeSpoken}</phoneme>`
          );
        }
      }
    }
    // Slight breathing break before unit words so numbers are never rushed
    body = body.replace(
      /(ڈگری سینٹی گریڈ|فیصد|میٹر فی سیکنڈ|کلو فی ایکڑ|ڊگري سينٽي گريڊ|سيڪڙو|ميٽر في سيڪنڊ|ڪلو في ايڪڙ)/g,
      '<break time="75ms"/>$1'
    );
    return `<s>${body}</s><break time="220ms"/>`;
  });

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">
  <voice xml:lang="${locale}" name="${escapeXml(params.voiceName)}">
    <prosody rate="${ratePct}" pitch="-2%">
      ${sentenceNodes.join('\n      ')}
    </prosody>
  </voice>
</speak>`;
}

/**
 * Generates W3C Pronunciation Lexicon Specification (PLS 1.0) XML
 * for engines supporting external phoneme lexicons (Azure Neural / compatible engines).
 */
export function buildPlsDocument(
  lang: VoiceLang,
  entries: LexiconEntry[]
): string {
  const locale = resolveExplicitLocale(lang);
  const lexemeBlocks = entries
    .map((entry) => {
      const graphemes = Array.from(new Set([entry.term, ...(entry.aliases || [])]))
        .map((g) => `<grapheme>${escapeXml(g)}</grapheme>`)
        .join('');
      const spoken = getLexiconReplacement(entry, lang);
      const ipa = lang === 'sd' ? entry.ipaSd : entry.ipaUr;
      const phonemeOrAlias = ipa
        ? `<phoneme>${escapeXml(ipa)}</phoneme>`
        : `<alias>${escapeXml(spoken)}</alias>`;
      return `  <lexeme>\n    ${graphemes}\n    ${phonemeOrAlias}\n  </lexeme>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0"
  xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
  alphabet="ipa" xml:lang="${locale}">
${lexemeBlocks}
</lexicon>`;
}
