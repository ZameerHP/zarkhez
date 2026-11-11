import { CropDiagnosis, getLocalizedText } from '../schemas';
import { toSpokenText } from './spoken-normalizer';
import type { VoiceLang } from './types';

const ROMAN_URDU_HINT_WORDS =
  /\b(?:hai|hain|nahi|nhi|aur|ke|ki|ka|ko|mein|me|par|pe|se|kar(?:ein|en|o)?|lagay(?:ein|en)|dein|lein|rakh(?:ein|en)|fasal|gandum|dhan|kapas|kamad|makai|tamatar|aloo|mirch|pani|khad|patta|patte|dhabbe|bimari|ilaj|spray|subah|shaam|barish|hawa|mausam|zameen|aap|hum|apni|bohat|zyada|kam|abhi|baad|pehle|zaroor)\b/gi;

const ROMAN_URDU_TO_URDU_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\baap\s+ki\s+fasal\b/gi, 'آپ کی فصل'],
  [/\baap\s+ke\b/gi, 'آپ کے'],
  [/\baap\s+ki\b/gi, 'آپ کی'],
  [/\baap\s+ko\b/gi, 'آپ کو'],
  [/\bkisan\s+bhai\b/gi, 'کسان بھائی'],
  [/\bassalam\s+o\s+alaikum\b/gi, 'السلام علیکم'],
  [/\bgandum\b/gi, 'گندم'],
  [/\bdhan\b/gi, 'دھان'],
  [/\bchawal\b/gi, 'چاول'],
  [/\bkapas\b/gi, 'کپاس'],
  [/\bkamad\b/gi, 'کماد'],
  [/\bganna\b/gi, 'گنا'],
  [/\bmakai\b/gi, 'مکئی'],
  [/\btamatar\b/gi, 'ٹماٹر'],
  [/\baloo\b/gi, 'آلو'],
  [/\bmirch\b/gi, 'مرچ'],
  [/\bpani\b/gi, 'پانی'],
  [/\baabpashi\b/gi, 'آبپاشی'],
  [/\bkhad\b/gi, 'کھاد'],
  [/\byurea\b|\burea\b/gi, 'یوریا'],
  [/\bzameen\b/gi, 'زمین'],
  [/\bfasal\b/gi, 'فصل'],
  [/\bpatta\b/gi, 'پتا'],
  [/\bpatte\b|\bpatton\b/gi, 'پتے'],
  [/\bpoda\b/gi, 'پودا'],
  [/\bpoday\b|\bpodon\b/gi, 'پودے'],
  [/\bdhabbe\b|\bdhabbay\b/gi, 'دھبے'],
  [/\bbimari\b|\bbeemari\b/gi, 'بیماری'],
  [/\bilaj\b/gi, 'علاج'],
  [/\bjhulsao\b/gi, 'جھلساؤ'],
  [/\bkangi\b/gi, 'کنگی'],
  [/\btela\b/gi, 'تیلہ'],
  [/\bsafaid\s+makhi\b/gi, 'سفید مکھی'],
  [/\bkeera\b|\bkeeron\b/gi, 'کیڑا'],
  [/\bspray\b/gi, 'سپرے'],
  [/\bbarish\b/gi, 'بارش'],
  [/\bmausam\b/gi, 'موسم'],
  [/\bhawa\b/gi, 'ہوا'],
  [/\bsubah\b/gi, 'صبح'],
  [/\bshaam\b/gi, 'شام'],
  [/\bsehatmand\b|\btandrust\b/gi, 'تندرست'],
  [/\bshiddat\b/gi, 'شدت'],
  [/\balamat\b|\balamaat\b/gi, 'علامات'],
  [/\bmuaina\b/gi, 'معائنہ'],
  [/\bmashwara\b/gi, 'مشورہ'],
  [/\bzaria\s+afsar\b/gi, 'زرعی افسر'],
  [/\bkhet\b/gi, 'کھیت'],
  [/\bbijai\b|\bbawai\b/gi, 'بوائی'],
  [/\bpehle\b/gi, 'پہلے'],
  [/\bbaad\b/gi, 'بعد'],
  [/\bzyada\b/gi, 'زیادہ'],
  [/\bmunasib\b/gi, 'مناسب'],
  [/\bforan\b/gi, 'فوراً'],
  [/\bzaroori\b|\bzaroor\b/gi, 'ضرور'],
  [/\bhargiz\b/gi, 'ہرگز'],
  [/\bnahi\b|\bnhi\b/gi, 'نہیں'],
  [/\bkarein\b|\bkaren\b/gi, 'کریں'],
  [/\blagayein\b|\blagayen\b/gi, 'لگائیں'],
  [/\bdein\b/gi, 'دیں'],
  [/\blein\b/gi, 'لیں'],
  [/\brakhein\b|\brakhen\b/gi, 'رکھیں'],
  [/\bhota\b/gi, 'ہوتا'],
  [/\bhoti\b/gi, 'ہوتی'],
  [/\bhain\b/gi, 'ہیں'],
  [/\bhai\b/gi, 'ہے'],
  [/\baur\b/gi, 'اور'],
  [/\bmein\b/gi, 'میں'],
  [/\bpar\b/gi, 'پر'],
  [/\bse\b/gi, 'سے'],
  [/\bko\b/gi, 'کو'],
  [/\bka\b/gi, 'کا'],
  [/\bki\b/gi, 'کی'],
  [/\bke\b/gi, 'کے'],
];

/**
 * Repairs stray Devanagari syllables accidentally emitted by an LLM inside Urdu text
 * (e.g., "دھब्बों" -> "دھبوں") so Pakistani Urdu TTS engines never choke on mixed scripts.
 */
export function repairStrayDevanagariInUrdu(text: string): string {
  if (!/[\u0900-\u097F]/.test(text)) return text;
  const charMap: Record<string, string> = {
    'अ': 'ا', 'आ': 'آ', 'इ': 'ا', 'ई': 'ی', 'उ': 'ا', 'ऊ': 'و', 'ए': 'ے', 'ओ': 'و',
    'क': 'ک', 'ख': 'کھ', 'ग': 'گ', 'घ': 'گھ', 'च': 'چ', 'छ': 'چھ', 'ज': 'ج', 'झ': 'جھ',
    'ट': 'ٹ', 'ठ': 'ٹھ', 'ड': 'ڈ', 'ढ': 'ڈھ', 'त': 'ت', 'थ': 'تھ', 'द': 'د', 'ध': 'دھ',
    'न': 'ن', 'प': 'پ', 'फ': 'پھ', 'ब': 'ب', 'भ': 'بھ', 'म': 'م', 'य': 'ی', 'र': 'ر',
    'ल': 'ل', 'व': 'و', 'श': 'ش', 'स': 'س', 'ह': 'ہ', 'ड़': 'ڑ', 'ज़': 'ز', 'फ़': 'ف',
    'क़': 'ق', 'ख़': 'خ', 'ग़': 'غ', 'ा': 'ا', 'ि': 'ِ', 'ी': 'ی', 'ु': 'ُ', 'ू': 'و',
    'े': 'ے', 'ो': 'و', 'ं': 'ں', 'ँ': 'ں', '्': '',
  };
  let out = '';
  for (const ch of text) {
    if (ch in charMap) {
      out += charMap[ch];
    } else if (/[\u0900-\u097F]/.test(ch)) {
      out += '';
    } else {
      out += ch;
    }
  }
  // Collapse unintended doubled consonant before Urdu plural endings (e.g., ب ب و -> ب و)
  return out.replace(/([\u0620-\u065F])\1+(?=وں|ے|ی)/g, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * Strips internal JSON, technical metadata labels, IDs, and Markdown noise
 * while preserving genuine agricultural/scientific names cleanly.
 */
export function cleanTechnicalMetadataForSpeech(raw: string): string {
  if (!raw) return '';
  let out = repairStrayDevanagariInUrdu(raw);

  // Strip JSON wrapper keys if LLM leaked raw JSON tokens
  out = out.replace(/"(?:screen_text|spoken_text|language|diagnosis_status|confidence_category|error_code|request_id|farmerId)"\s*:\s*/gi, ' ');
  // Remove technical UUIDs and internal ZRK-PK-... tokens from spoken narration
  out = out.replace(/\bZRK-PK-[A-Z0-9]+\b/gi, '');
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
  // Strip code blocks, URLs, and markdown markers
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
  out = out.replace(/[#*_~`>|•◦▪▫●○]/g, ' ');
  // Normalize duplicated punctuation (avoid TTS spelling out multiple dots)
  out = out.replace(/\.{2,}/g, '.').replace(/۔{2,}/g, '۔');
  // Replace bare heading colons mid-line with gentle phrasing pause commas
  out = out.replace(/:\s*\n+/g, '، ').replace(/\s*\n+\s*/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Detects whether a response intended for Urdu TTS was accidentally emitted in Roman Urdu.
 */
export function looksLikeRomanUrdu(text: string): boolean {
  if (!text || !text.trim()) return false;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (text.match(/[A-Za-z]/g) || []).length;
  if (latinChars < 12) return false;
  if (arabicChars > latinChars) return false;
  const matches = text.match(ROMAN_URDU_HINT_WORDS) || [];
  return matches.length >= 2;
}

/**
 * Deterministic fast Roman-Urdu -> Urdu script fallback mapper
 * preserving scientific binomials and medicine names cleanly.
 */
export function transliterateCommonRomanUrduToUrdu(text: string): string {
  let out = text;
  for (const [rx, ur] of ROMAN_URDU_TO_URDU_WORDS) {
    out = out.replace(rx, ur);
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Full deterministic speech-preparation pipeline before sending to Azure/Gemini TTS.
 */
export function prepareSpeechText(rawText: string, lang: VoiceLang): string {
  const cleaned = cleanTechnicalMetadataForSpeech(rawText);
  if (!cleaned) return '';

  const scriptReady =
    lang === 'ur' && looksLikeRomanUrdu(cleaned)
      ? transliterateCommonRomanUrduToUrdu(cleaned)
      : cleaned;

  const normalized = toSpokenText(scriptReady, lang);
  return normalized.spokenText;
}

/**
 * Splits long passages strictly at natural sentence boundaries so chunked streaming
 * never breaks mid-word or introduces choppy mid-clause pauses.
 */
export function splitSpeechIntoChunks(
  spokenText: string,
  lang: VoiceLang,
  maxChars = 620
): string[] {
  const clean = cleanPreserveSpaces(spokenText);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const delimiter = lang === 'en' ? '.' : '۔';
  const sentences = clean
    .split(/(?<=[۔.!?؟])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (sentence.length <= maxChars) {
      current = sentence;
    } else {
      // Fallback split on comma boundaries before hard word boundary
      const words = sentence.split(/\s+/);
      let piece = '';
      for (const word of words) {
        const nextPiece = piece ? `${piece} ${word}` : word;
        if (nextPiece.length <= maxChars - 1) {
          piece = nextPiece;
        } else {
          if (piece) chunks.push(`${piece.replace(/[۔.!?؟]+$/, '')}${delimiter}`);
          piece = word;
        }
      }
      if (piece) current = piece;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function cleanPreserveSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function formatSeverityPhrase(
  severity: CropDiagnosis['severity'],
  lang: 'en' | 'ur'
): string {
  if (lang === 'en') {
    if (severity === 'high') return 'high severity';
    if (severity === 'medium') return 'medium severity';
    if (severity === 'low') return 'low severity';
    return '';
  }
  if (severity === 'high') return 'زیادہ شدید';
  if (severity === 'medium') return 'درمیانی';
  if (severity === 'low') return 'ہلکی';
  return '';
}

/**
 * Builds a complete, natural conversational human advisor summary for any Scan result
 * using ONLY grounded fields from the diagnosis object (zero hallucinated facts).
 */
export function buildScanVoiceNarration(
  diagnosis: CropDiagnosis,
  lang: 'en' | 'ur'
): string {
  if (!diagnosis) return '';

  if (
    diagnosis.diagnosis_status === 'invalid_image' ||
    diagnosis.diagnosis_status === 'crop_mismatch' ||
    diagnosis.requires_retake
  ) {
    const msg = getLocalizedText(diagnosis.message, lang);
    const retakeTip =
      lang === 'en'
        ? 'Please take a clear close-up photo in natural daylight and scan again.'
        : 'براہ کرم دن کی صاف روشنی میں پتے کی واضح تصویر لے کر دوبارہ اسکین کریں۔';
    return cleanPreserveSpaces(msg || retakeTip);
  }

  const cropName =
    lang === 'en'
      ? diagnosis.detected_crop || diagnosis.selected_crop || 'crop'
      : diagnosis.detected_crop_ur || diagnosis.detected_crop || 'فصل';
  const partName =
    lang === 'en'
      ? (diagnosis.detected_plant_part || 'plant').toLowerCase()
      : diagnosis.detected_plant_part_ur || diagnosis.detected_plant_part || 'پتے';
  const conditionName = getLocalizedText(diagnosis.problem_name, lang);
  const confPct = Math.round((diagnosis.identification_confidence || 0) * 100);
  const severityText = formatSeverityPhrase(diagnosis.severity, lang);

  const firstSymptom =
    diagnosis.observed_symptoms && diagnosis.observed_symptoms.length > 0
      ? getLocalizedText(diagnosis.observed_symptoms[0], lang)
      : '';
  const secondSymptom =
    diagnosis.observed_symptoms && diagnosis.observed_symptoms.length > 1
      ? getLocalizedText(diagnosis.observed_symptoms[1], lang)
      : '';
  const observation = getLocalizedText(diagnosis.why_suspected, lang);

  const immediateActions = diagnosis.treatment_pillars?.immediate_actions || [];
  const primarySteps =
    immediateActions.length > 0
      ? immediateActions.slice(0, 2).map((s) => getLocalizedText(s, lang)).filter(Boolean)
      : (diagnosis.recommendations || [])
          .slice(0, 2)
          .map((s) => getLocalizedText(s, lang))
          .filter(Boolean);

  if (diagnosis.diagnosis_status === 'healthy_no_symptoms') {
    if (lang === 'en') {
      const parts = [
        `Good news — your ${cropName} ${partName} appears healthy, with ${confPct}% confidence and no signs of infection.`,
        observation ? observation.replace(/\.+$/, '') + '.' : '',
        primarySteps.length > 0
          ? `Keep up your regular routine care. ${primarySteps.join(' ')}`
          : "Keep checking the field regularly, and don't spend money on unnecessary sprays.",
      ];
      return cleanPreserveSpaces(parts.filter(Boolean).join(' '));
    }

    const partsUr = [
      `خوشخبری کسان بھائی، آپ کی ${cropName} کے ${partName} بالکل تندرست لگ رہے ہیں، اور ${confPct}% اعتماد کے ساتھ کسی بیماری یا انفیکشن کی کوئی علامت نہیں ہے۔`,
      observation ? observation.replace(/[۔.]+$/, '') + '۔' : '',
      primarySteps.length > 0
        ? `معمول کی دیکھ بھال جاری رکھیں، ${primarySteps.join(' ')}`
        : 'کھیت کا باقاعدہ چکر لگاتے رہیں اور بلاوجہ سپرے ہرگز نہ کریں۔',
    ];
    return cleanPreserveSpaces(partsUr.filter(Boolean).join(' '));
  }

  if (lang === 'en') {
    const severityClause = severityText ? `, with ${severityText}` : '';
    const confClause = confPct > 0 ? ` and ${confPct}% confidence` : '';
    const intro = `Your ${cropName} ${partName} appears to be affected by ${conditionName}${severityClause}${confClause}.`;

    const symptomItems = [firstSymptom, secondSymptom].filter(Boolean);
    const symptomSentence =
      symptomItems.length > 0
        ? `The scan picked up ${symptomItems.join(' and ').replace(/\.+$/, '')}.`
        : observation
        ? `${observation.replace(/\.+$/, '')}.`
        : '';

    const actionSentence =
      primarySteps.length > 0
        ? `To protect your crop right away, ${primarySteps.join(' ')}`
        : getLocalizedText(diagnosis.when_to_consult_expert, 'en');

    return cleanPreserveSpaces([intro, symptomSentence, actionSentence].filter(Boolean).join(' '));
  }

  const severityAndConfUr =
    severityText && confPct > 0
      ? `، جس کی شدت ${severityText} ہے اور تشخیص کا اعتماد ${confPct}% ہے`
      : severityText
      ? `، اور اس کی شدت ${severityText} ہے`
      : confPct > 0
      ? `، جس کی تصدیق کا اعتماد ${confPct}% ہے`
      : '';
  const introUr = `آپ کی ${cropName} کے ${partName} میں ${conditionName} کی علامات نظر آ رہی ہیں${severityAndConfUr}۔`;

  const symptomUrItems = [firstSymptom, secondSymptom].filter(Boolean);
  const symptomUr =
    symptomUrItems.length > 0
      ? `پودے پر ${symptomUrItems.join(' اور ').replace(/[۔.]+$/, '')} صاف دکھائی دے رہے ہیں۔`
      : observation
      ? `${observation.replace(/[۔.]+$/, '')}۔`
      : '';

  const actionUr =
    primarySteps.length > 0
      ? `فصل کو مزید نقصان سے بچانے کے لیے ${primarySteps.join(' ')}`
      : getLocalizedText(diagnosis.when_to_consult_expert, 'ur');

  return cleanPreserveSpaces([introUr, symptomUr, actionUr].filter(Boolean).join(' '));
}
