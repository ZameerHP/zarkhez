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
    return Math.min(1.25, Math.max(0.7, numericSpeed));
  }
  return speedMode === 'slow' ? 0.82 : 1.0;
}

/**
 * Generates clean W3C SSML 1.0 markup optimized for Azure Neural natural human speech:
 * explicit locale xml:lang, natural speaking rate (0% normal, -18% slow repeat),
 * natural unshifted pitch (0%), natural sentence continuity without forced mid-phrase pauses,
 * and selective <phoneme> cues only for foreign loanwords/brands needing phonetic guidance.
 */
export function buildVoiceSsml(params: {
  text: string;
  lang: VoiceLang;
  voiceName: string;
  speedMode?: VoiceSpeedMode;
  speedRate?: number;
  lexiconEntries?: LexiconEntry[];
  style?: 'friendly' | 'none';
}): string {
  const locale = resolveExplicitLocale(params.lang);
  const ssmlLocale = params.voiceName.startsWith('en-US-') ? 'en-US' : locale;
  const rate = resolveSpeakingRate(params.speedMode, params.speedRate);
  const rateDelta = Math.round((rate - 1) * 100);
  const ratePct = rateDelta === 0 ? '0%' : `${rateDelta > 0 ? '+' : ''}${rateDelta}%`;
  const useFriendlyStyle = params.style === 'friendly';

  const normalized = toSpokenText(params.text, params.lang, {
    lexiconEntries: params.lexiconEntries,
  });

  const sentenceNodes = normalized.sentences.map((sentence, idx) => {
    let body = escapeXml(sentence);
    if (params.lexiconEntries) {
      for (const entry of params.lexiconEntries) {
        // Apply explicit IPA phoneme overrides only to foreign brand/loanword/pesticide terms;
        // native Urdu/English vocabulary flows far more naturally via Azure's own neural lexicon.
        const needsPhonemeOverride =
          entry.category === 'pesticide' ||
          entry.category === 'brand' ||
          entry.category === 'greeting' ||
          entry.category === 'loanword';
        if (!needsPhonemeOverride) continue;

        const spoken = getLexiconReplacement(entry, params.lang);
        const ipa =
          params.lang === 'sd'
            ? entry.ipaSd
            : params.lang === 'en'
            ? entry.ipaEn
            : entry.ipaUr;
        if (spoken && ipa && body.includes(escapeXml(spoken))) {
          const safeSpoken = escapeXml(spoken);
          body = body.replace(
            safeSpoken,
            `<phoneme alphabet="ipa" ph="${escapeXml(ipa)}">${safeSpoken}</phoneme>`
          );
        }
      }
    }
    const isLast = idx === normalized.sentences.length - 1;
    return isLast ? `<s>${body}</s>` : `<s>${body}</s><break time="120ms"/>`;
  });

  const prosodyBlock = `<prosody rate="${ratePct}" pitch="0%">
      <p>${sentenceNodes.join('\n      ')}</p>
    </prosody>`;

  const innerBody = useFriendlyStyle
    ? `<mstts:express-as style="friendly" styledegree="0.85">
      ${prosodyBlock}
    </mstts:express-as>`
    : prosodyBlock;

  const msttsAttr = useFriendlyStyle ? ' xmlns:mstts="https://www.w3.org/2001/mstts"' : '';

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"${msttsAttr} xml:lang="${ssmlLocale}">
  <voice xml:lang="${ssmlLocale}" name="${escapeXml(params.voiceName)}">
    ${innerBody}
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
