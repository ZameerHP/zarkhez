import type { LexiconEntry, NormalizedSpokenResult, VoiceLang } from './types';
import {
  cleanPreserveScript,
  containsSindhiLetters,
  assertSindhiLettersPreserved,
  resolveExplicitLocale,
} from './script-guard';
import {
  numberStringToWords,
  ordinalToWords,
  timeToSpokenWords,
} from './number-words';
import {
  getBundledLexiconEntries,
  getLexiconReplacement,
} from './lexicon-loader';

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripNonSpokenSymbols(raw: string): string {
  return raw
    // Remove code blocks and URLs
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    // Strip markdown formatting, headings, bold/italic, bullets, pipes
    .replace(/[#*_~`>|•◦▪▫●○]/g, ' ')
    // Remove emojis & pictographs cleanly (ES5-compatible surrogate pairs + symbols)
    .replace(/(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]|\uFE0F)/g, ' ')
    // Replace brackets & dashes used visually with slight phrasing pause
    .replace(/[(){}[\]<>]/g, ' ')
    .replace(/\s+[-–—]+\s+/g, '، ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandTimeExpressions(text: string, lang: VoiceLang): string {
  return text.replace(/\b(\d{1,2}):(\d{2})(?:\s*(am|pm))?\b/gi, (_m, hStr, mStr, ampm) => {
    let hour = Number(hStr);
    const min = Number(mStr);
    if (!Number.isFinite(hour) || !Number.isFinite(min) || min > 59 || hour > 24) {
      return `${hStr} ${mStr}`;
    }
    if (ampm) {
      const low = String(ampm).toLowerCase();
      if (low === 'pm' && hour < 12) hour += 12;
      if (low === 'am' && hour === 12) hour = 0;
    }
    return timeToSpokenWords(hour, min, lang);
  });
}

function expandUnitsAndNumbers(text: string, lang: VoiceLang): string {
  const unitLabels =
    lang === 'sd'
      ? {
          degC: 'ڊگري سينٽي گريڊ',
          deg: 'ڊگري',
          pct: 'سيڪڙو',
          ms: 'ميٽر في سيڪنڊ',
          kmh: 'ڪلوميٽر في ڪلاڪ',
          kgAcre: 'ڪلو في ايڪڙ',
          lAcre: 'ليٽر في ايڪڙ',
          mlL: 'ملي ليٽر في ليٽر',
          mm: 'ملي ميٽر',
          ml: 'ملي ليٽر',
          kg: 'ڪلوگرام',
          gram: 'گرام',
          liter: 'ليٽر',
          rupees: 'رپيا',
        }
      : lang === 'ur'
      ? {
          degC: 'ڈگری سینٹی گریڈ',
          deg: 'ڈگری',
          pct: 'فیصد',
          ms: 'میٹر فی سیکنڈ',
          kmh: 'کلومیٹر فی گھنٹہ',
          kgAcre: 'کلو فی ایکڑ',
          lAcre: 'لیٹر فی ایکڑ',
          mlL: 'ملی لیٹر فی لیٹر',
          mm: 'ملی میٹر',
          ml: 'ملی لیٹر',
          kg: 'کلوگرام',
          gram: 'گرام',
          liter: 'لیٹر',
          rupees: 'روپے',
        }
      : {
          degC: 'degrees Celsius',
          deg: 'degrees',
          pct: 'percent',
          ms: 'meters per second',
          kmh: 'kilometers per hour',
          kgAcre: 'kilograms per acre',
          lAcre: 'liters per acre',
          mlL: 'milliliters per liter',
          mm: 'millimeters',
          ml: 'milliliters',
          kg: 'kilograms',
          gram: 'grams',
          liter: 'liters',
          rupees: 'Rupees',
        };

  let out = text;

  // Normalize comma-formatted numbers inside numeric contexts (e.g. 85,000 -> 85000)
  out = out.replace(/(\d),(\d{3})\b/g, '$1$2');

  // Numbered list prefixes at start or after sentence delimiter (natural spoken transitions)
  out = out.replace(/(?:^|(?<=[۔.!?]\s*))(\d{1,2})\.\s+/g, (_m, nStr) => {
    const n = Number(nStr);
    if (lang === 'en') {
      const ord = ordinalToWords(n, 'en');
      return `${ord.charAt(0).toUpperCase()}${ord.slice(1)}, `;
    }
    if (lang === 'ur') {
      const urListTransitions: Record<number, string> = {
        1: 'پہلے',
        2: 'دوسرے',
        3: 'تیسرے',
        4: 'چوتھے',
        5: 'پانچویں',
      };
      return `${urListTransitions[n] || ordinalToWords(n, 'ur')}، `;
    }
    return `${ordinalToWords(n, lang)}، `;
  });

  // Currency Rs. / PKR before OR after number
  out = out.replace(/\b(?:Rs\.?|PKR)\s*(\d+(?:\.\d+)?)\b/gi, (_m, num) => {
    return `${numberStringToWords(num, lang)} ${unitLabels.rupees}`;
  });
  out = out.replace(/\b(\d+(?:\.\d+)?)\s*(?:Rs\.?|PKR)\b/gi, (_m, num) => {
    return `${numberStringToWords(num, lang)} ${unitLabels.rupees}`;
  });

  // Compound rate & agricultural dosage units (order matters: longest first!)
  out = out.replace(/(\d+(?:\.\d+)?)\s*°\s*C\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.degC}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*°/g, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.deg}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*%/g, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.pct}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*m\s*\/\s*s\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.ms}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*km\s*\/\s*h\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.kmh}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*kg\s*\/\s*acre\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.kgAcre}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*l(?:iter|itre)?\s*\/\s*acre\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.lAcre}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*ml\s*\/\s*l\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.mlL}`);

  // Standalone unit abbreviations without leading digits
  out = out.replace(/\bkg\s*\/\s*acre\b/gi, unitLabels.kgAcre);
  out = out.replace(/\bm\s*\/\s*s\b/gi, unitLabels.ms);
  out = out.replace(/\bkm\s*\/\s*h\b/gi, unitLabels.kmh);

  // Common unit abbreviations with leading number
  out = out.replace(/(\d+(?:\.\d+)?)\s*mm\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.mm}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*ml\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.ml}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*kg\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.kg}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/gi, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.gram}`);
  out = out.replace(/(\d+(?:\.\d+)?)\s*(?:L|liters?|litres?)\b/g, (_m, num) => `${numberStringToWords(num, lang)} ${unitLabels.liter}`);

  // Ranges like "20-25"
  out = out.replace(/\b(\d+)\s*[-–]\s*(\d+)\b/g, (_m, a, b) => {
    const conn = lang === 'sd' ? 'کان' : lang === 'ur' ? 'سے' : 'to';
    return `${numberStringToWords(a, lang)} ${conn} ${numberStringToWords(b, lang)}`;
  });

  // Remaining decimals & integers (including Eastern Arabic / Urdu digits normalized first)
  const easternDigitsNormalized = out.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return String(code - 0x0660);
  });

  out = easternDigitsNormalized.replace(/\b(\d+(?:\.\d+)?)\b/g, (num) => numberStringToWords(num, lang));
  out = out.replace(/\bRs\.?\s*/gi, `${unitLabels.rupees} `);
  out = out.replace(/\bPKR\b/gi, unitLabels.rupees);

  return out;
}

function applyPronunciationLexicon(
  text: string,
  lang: VoiceLang,
  entries: LexiconEntry[]
): { text: string; appliedIds: string[]; needsNativeReview: boolean } {
  let out = text;
  const appliedIds: string[] = [];
  let needsNativeReview = lang === 'sd';

  // Longest aliases first to avoid partial collisions (e.g. "Ridomil Gold" before "Ridomil")
  const expandedPairs: Array<{ entry: LexiconEntry; alias: string }> = [];
  for (const entry of entries) {
    const aliases = [entry.term, ...(entry.aliases || [])].filter(Boolean);
    for (const alias of aliases) {
      expandedPairs.push({ entry, alias });
    }
  }
  expandedPairs.sort((a, b) => b.alias.length - a.alias.length);

  for (const { entry, alias } of expandedPairs) {
    const replacement = getLexiconReplacement(entry, lang);
    if (!replacement || replacement === alias) continue;

    const isAscii = /^[\x00-\x7F]+$/.test(alias);
    const rx = isAscii
      ? new RegExp(`\\b${escapeRegex(alias)}\\b`, 'gi')
      : new RegExp(`(^|[\\s،۔.!?:؟؛"'\\(\\)])(${escapeRegex(alias)})(?=$|[\\s،۔.!?:؟؛"'\\(\\)])`, 'g');

    if (rx.test(out)) {
      rx.lastIndex = 0;
      out = isAscii
        ? out.replace(rx, replacement)
        : out.replace(rx, (_m, lead) => `${lead}${replacement}`);
      if (!appliedIds.includes(entry.id)) {
        appliedIds.push(entry.id);
      }
      if (entry.needs_native_review) {
        needsNativeReview = true;
      }
    }
  }

  return { text: out, appliedIds, needsNativeReview };
}

/**
 * Splits long passages into calm, short spoken sentences (< maxWords each)
 * with authentic script punctuation (۔ for ur/sd, . for en) for natural breathing.
 */
export function splitShortSpokenSentences(
  text: string,
  lang: VoiceLang,
  maxWords = 40
): string[] {
  const defaultDelimiter = lang === 'en' ? '.' : '۔';
  const clauseJoiner = lang === 'en' ? ', ' : '، ';
  const rawSentences = text
    .split(/(?<=[۔.!?؟\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const output: string[] = [];

  for (const rawSentence of rawSentences) {
    const endPunctMatch = rawSentence.match(/([۔.!?؟]+)$/);
    const preservedEnd =
      endPunctMatch && (endPunctMatch[1].includes('؟') || endPunctMatch[1].includes('?'))
        ? lang === 'en'
          ? '?'
          : '؟'
        : defaultDelimiter;

    const cleanSent = rawSentence.replace(/[۔.!?؟]+$/, '').trim();
    if (!cleanSent) continue;

    const words = cleanSent.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      output.push(`${cleanSent}${preservedEnd}`);
      continue;
    }

    // Preserve natural comma phrasing between clauses when packing long sentences,
    // inserting full sentence breaks only when breath length reaches maxWords.
    const connectorSplit =
      lang === 'ur'
        ? cleanSent.replace(/\s+(اور|کیونکہ|جبکہ|اس لیے|تاکہ)\s+/g, '، $1 ')
        : lang === 'sd'
        ? cleanSent.replace(/\s+(۽|ڇو ته|جڏهن ته|ان ڪري)\s+/g, '، $1 ')
        : cleanSent.replace(/\s+(and|because|while|so)\s+/gi, ', $1 ');

    const clauses = connectorSplit.split(/[،,؛;]+/).map((c) => c.trim()).filter(Boolean);
    let currentClauses: string[] = [];
    let currentWordCount = 0;

    for (let ci = 0; ci < clauses.length; ci++) {
      const clause = clauses[ci];
      const isLastClause = ci === clauses.length - 1;
      const cWords = clause.split(/\s+/).filter(Boolean);
      if (currentWordCount + cWords.length <= maxWords) {
        currentClauses.push(clause);
        currentWordCount += cWords.length;
      } else {
        if (currentClauses.length > 0) {
          output.push(`${currentClauses.join(clauseJoiner)}${defaultDelimiter}`);
          currentClauses = [];
          currentWordCount = 0;
        }
        if (cWords.length <= Math.max(24, maxWords - 8)) {
          currentClauses.push(clause);
          currentWordCount += cWords.length;
        } else {
          for (let i = 0; i < cWords.length; i += 28) {
            const chunk = cWords.slice(i, i + 28).join(' ');
            const isFinal = isLastClause && i + 28 >= cWords.length;
            output.push(`${chunk}${isFinal ? preservedEnd : defaultDelimiter}`);
          }
        }
      }
    }
    if (currentClauses.length > 0) {
      output.push(`${currentClauses.join(clauseJoiner)}${preservedEnd}`);
    }
  }

  return output;
}

/**
 * Canonical pre-TTS spoken normalizer.
 * Converts numbers, times, units, symbols, loanwords, and long prose into clear,
 * speakable natural phrasing while strictly preserving Sindhi Perso-Arabic letters.
 */
export function toSpokenText(
  rawText: string,
  lang: VoiceLang,
  options?: {
    lexiconEntries?: LexiconEntry[];
    maxWordsPerSentence?: number;
  }
): NormalizedSpokenResult {
  const localeCode = resolveExplicitLocale(lang);
  const safeBase = cleanPreserveScript(rawText || '');

  if (!safeBase) {
    return {
      originalText: rawText || '',
      spokenText: '',
      sentences: [],
      words: [],
      lang,
      localeCode,
      needsNativeReview: lang === 'sd',
      appliedLexiconIds: [],
      preservesSindhiLetters: true,
    };
  }

  const stripped = stripNonSpokenSymbols(safeBase);
  const withTimes = expandTimeExpressions(stripped, lang);
  const withUnitsAndNumbers = expandUnitsAndNumbers(withTimes, lang);
  const entries = options?.lexiconEntries || getBundledLexiconEntries();
  const lexApplied = applyPronunciationLexicon(withUnitsAndNumbers, lang, entries);

  const sentences = splitShortSpokenSentences(
    lexApplied.text,
    lang,
    options?.maxWordsPerSentence ?? 40
  );

  const spokenText = cleanPreserveScript(sentences.join(' '));
  const words = spokenText
    .replace(/[۔.!?؟،,؛;:]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const check =
    lang === 'sd' || containsSindhiLetters(rawText)
      ? assertSindhiLettersPreserved(rawText, spokenText)
      : { valid: true, missingChars: [] };

  return {
    originalText: rawText,
    spokenText,
    sentences,
    words,
    lang,
    localeCode,
    needsNativeReview: lang === 'sd' || lexApplied.needsNativeReview,
    appliedLexiconIds: lexApplied.appliedIds,
    preservesSindhiLetters: check.valid,
  };
}
