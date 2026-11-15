import {
  convertMarkdownReplyToSpokenText,
  looksLikeRomanUrdu,
  repairStrayDevanagariInUrdu,
  transliterateCommonRomanUrduToUrdu,
} from './voice/speech-prep';
import type { VoiceLang } from './voice/types';

export type AdvisorLanguageMode = 'en' | 'ur-script' | 'roman-ur' | 'sd';

export interface AdvisorFarmerProfile {
  name?: string;
  farmerId?: string;
  district?: string;
  crop?: string;
  acres?: number;
  stage?: string;
  region?: string;
  farmerName?: string;
  weatherSummary?: string;
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SINDHI_CHAR_REGEX = /[ٻڀٺٽڄڃڇڊڌڍڏڙڦڪڳڱڻ۽۾]/;
const ARABIC_URDU_REGEX = /[\u0600-\u06FF]/;

const STRICT_ROMAN_URDU_TOKENS_REGEX =
  /\b(?:hai|hain|nahi|nhi|aur|ke|ki|ka|ko|mein|se|kar(?:ein|en|o)?|lagay(?:ein|en)|lagana|dein|lein|rakh(?:ein|en)|fasal|gandum|dhan|kapas|kamad|makai|tamatar|aloo|mirch|pani|khad|yurea|patta|patte|paton|peela|peely|peelay|dhabbe|bimari|beemari|ilaj|subah|shaam|barish|hawa|mausam|zameen|aap|hum|apni|bohat|zyada|abhi|baad|pehle|zaroor|ugana|ugane|ugayen|ugayein|beej|bijai|bawai|tayari|taiyari|tareeqa|tarika|tareeka|mukammal|samjhao|samjhaein|batao|batayen|batayein|kya|kyun|kaise|kese|kab|kitna|kitni|kitne|kaunsa|konsi|chahiye|chahie|hota|hoti|mera|meri|mere|hamara|khet|sukr|sukar|karna|dalna|dalon|dalen|dalo|masla)\b/gi;

const ENGLISH_GRAMMAR_CUES_REGEX =
  /\b(?:what|how|why|when|where|which|who|should|could|would|can|do|does|did|is|are|was|were|will|my|our|your|the|me|want|tell|explain|compare|between|grow|growing|cultivate|prepare|preparation|complete|process|beginner|nothing|about|farming|fertilizer|irrigation|irrigate|yellow|turning|leaves|crop|soil|wheat|barley|acres|please|help|need)\b/gi;

function isDominantRomanUrdu(text: string): boolean {
  const urMatches = text.match(STRICT_ROMAN_URDU_TOKENS_REGEX) || [];
  if (urMatches.length === 0) return false;
  const enMatches = text.match(ENGLISH_GRAMMAR_CUES_REGEX) || [];
  if (urMatches.length >= 2) {
    return urMatches.length >= enMatches.length;
  }
  return enMatches.length === 0 || looksLikeRomanUrdu(text);
}

/**
 * Returns true if the message contains unmistakable English prose rather than
 * Roman Urdu or Urdu/Sindhi script.
 */
export function looksLikelyEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (SINDHI_CHAR_REGEX.test(trimmed) || ARABIC_URDU_REGEX.test(trimmed)) {
    return false;
  }
  if (isDominantRomanUrdu(trimmed)) {
    return false;
  }
  const matches = trimmed.match(ENGLISH_GRAMMAR_CUES_REGEX) || [];
  return matches.length >= 1;
}

/**
 * Resolves the actual target response language/script based on the latest user turn,
 * falling back to prior conversation turns and UI language defaults.
 */
export function detectUserLanguageMode(
  text: string,
  voiceLang?: VoiceLang,
  uiLang?: 'en' | 'ur',
  history?: ChatHistoryTurn[]
): { mode: AdvisorLanguageMode; voiceLang: VoiceLang } {
  const trimmed = (text || '').trim();

  if (SINDHI_CHAR_REGEX.test(trimmed)) {
    return { mode: 'sd', voiceLang: 'sd' };
  }
  if (ARABIC_URDU_REGEX.test(trimmed)) {
    if (voiceLang === 'sd') {
      return { mode: 'sd', voiceLang: 'sd' };
    }
    return { mode: 'ur-script', voiceLang: 'ur' };
  }
  if (isDominantRomanUrdu(trimmed)) {
    return { mode: 'roman-ur', voiceLang: 'ur' };
  }
  if (looksLikelyEnglish(trimmed)) {
    return { mode: 'en', voiceLang: 'en' };
  }

  // Neutral inputs (e.g., numbers or single city names like "Bahawalpur"): inherit prior user turn language
  if (history && history.length > 1) {
    const priorUsers = [...history]
      .slice(0, -1)
      .reverse()
      .filter((m) => m.role === 'user');
    for (const prev of priorUsers) {
      if (SINDHI_CHAR_REGEX.test(prev.content)) {
        return { mode: 'sd', voiceLang: 'sd' };
      }
      if (ARABIC_URDU_REGEX.test(prev.content)) {
        return {
          mode: voiceLang === 'sd' ? 'sd' : 'ur-script',
          voiceLang: voiceLang === 'sd' ? 'sd' : 'ur',
        };
      }
      if (isDominantRomanUrdu(prev.content)) {
        return { mode: 'roman-ur', voiceLang: 'ur' };
      }
      if (looksLikelyEnglish(prev.content)) {
        return { mode: 'en', voiceLang: 'en' };
      }
    }
  }

  if (voiceLang === 'sd') return { mode: 'sd', voiceLang: 'sd' };
  if (voiceLang === 'en' || uiLang === 'en') return { mode: 'en', voiceLang: 'en' };
  return { mode: 'roman-ur', voiceLang: 'ur' };
}

/**
 * Resolves final screen mode and spoken voice language while honoring explicit
 * user language locks (especially Sindhi `sd` or explicitly clicked voice pills).
 */
export function resolveAdvisorLanguageSelection(params: {
  text: string;
  voiceLang?: VoiceLang;
  uiLang?: 'en' | 'ur';
  history?: ChatHistoryTurn[];
  explicitVoiceLang?: boolean;
}): { mode: AdvisorLanguageMode; voiceLang: VoiceLang; isLocked: boolean } {
  const detected = detectUserLanguageMode(
    params.text,
    params.voiceLang,
    params.uiLang,
    params.history
  );
  const isLocked = params.voiceLang === 'sd' || Boolean(params.explicitVoiceLang);
  if (!isLocked || !params.voiceLang) {
    return {
      mode: detected.mode,
      voiceLang: detected.mode === 'sd' ? 'sd' : detected.voiceLang,
      isLocked: false,
    };
  }

  const lockedVoiceLang = params.voiceLang;
  const lockedMode: AdvisorLanguageMode =
    lockedVoiceLang === 'sd'
      ? 'sd'
      : lockedVoiceLang === 'en'
      ? 'en'
      : detected.mode === 'roman-ur'
      ? 'roman-ur'
      : 'ur-script';

  return {
    mode: lockedMode,
    voiceLang: lockedVoiceLang,
    isLocked: true,
  };
}

/**
 * Cleans leaked internal metadata or stray Devanagari characters from formatted screen Markdown
 * while preserving headings, bold markers, bullet/numbered lists, tables, and line breaks.
 */
export function cleanScreenAdvisorText(raw: string): string {
  if (!raw) return '';
  let out = repairStrayDevanagariInUrdu(raw);
  // Convert escaped literal newlines from JSON payloads if any survived
  out = out.replace(/\\n/g, '\n');
  out = out.replace(
    /"?(?:screen_text|spoken_text|language|diagnosis_status|confidence_category|error_code|request_id|farmerId)"?\s*:\s*/gi,
    ''
  );
  out = out.replace(/\bZRK-PK-[A-Z0-9]+\b/gi, '');
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
  // Strip outer markdown json code fences if the model wrapped the entire response
  out = out.replace(/^```(?:json|markdown|md)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
  // Collapse excessive blank lines without flattening structure
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function buildLanguageDirective(mode: AdvisorLanguageMode): string {
  if (mode === 'en') {
    return `### LANGUAGE & TONE (NATURAL ENGLISH):
- Respond in warm, fluent, clear everyday English as an experienced Pakistani agricultural expert and patient teacher.
- Explain farming terms simply when they first appear, and keep guidance grounded in Pakistani seasons (Rabi / Kharif), soils, and practical realities.`;
  }

  if (mode === 'ur-script') {
    return `### LANGUAGE & TONE (PAKISTANI URDU SCRIPT):
- Write in clear, natural, respectful Pakistani Urdu Perso-Arabic script (ا ب ت), NEVER Roman Urdu and NEVER Hindi/Devanagari words.
- Keep familiar farming product names natural where helpful alongside Urdu (مثلاً یوریا Urea، ڈی اے پی DAP، پوٹاش SOP، ٹِیلہ، کنگی، جھلساؤ، وتر، بوائی).
- Address the farmer warmly without stiff newsroom jargon or repeating their name/ID in every reply.`;
  }

  if (mode === 'sd') {
    return `### LANGUAGE & TONE (PAKISTANI SINDHI SCRIPT):
- Write in warm, natural everyday Pakistani Sindhi Perso-Arabic script (سنڌي using ڀ ٻ ڄ ڃ ڇ ڏ ڊ ڌ ڍ ڙ ڦ ڪ ڳ ڱ ڻ ٿ ٺ ٽ ي ه).
- Use clear, respectful rural farming terms (ٻني، پاڻي، ڀاڻ، پاڙون، مٽي، پوک، لابارو). NEVER mix Urdu or Hindi words into Sindhi sentences.`;
  }

  return `### STRICT LANGUAGE DIRECTIVE (PAKISTANI ROMAN URDU):
- When the user writes in Roman Urdu or mixed Urdu-English, ALWAYS respond in authentic, fluent PAKISTANI ROMAN URDU using ONLY Latin/English letters.
- NEVER write in Nastaliq / Urdu Arabic script (ا ب ت) in Roman Urdu mode.
- NEVER use Hindi or Devanagari words (never say "kripya", "samasya", "vivaran", "dhanyawad", "namaste", "krishi", "mitr").
- Keep natural Pakistani farming terms ("spray", "urea", "DAP", "potash", "fertilizer", "variety", "acre", "irrigation", "soil test", "watr", "bijai") smoothly inside clear everyday Urdu sentences.`;
}

function buildProfileContextBlock(profile?: AdvisorFarmerProfile): string {
  if (!profile) return '';
  const name = profile.name || profile.farmerName || 'Farmer';
  const district = profile.district || profile.region || 'Punjab / Sindh, Pakistan';
  const crop = profile.crop || 'Wheat';
  const acres = profile.acres ? `${profile.acres} Acres` : 'Smallholder';
  const weather = profile.weatherSummary || 'Clear';
  const farmerId = profile.farmerId || 'ZRK-PK';

  return `\n### FARMER CONTEXT (Internal background — use silently unless relevant to the question):
- Farmer Name: ${name}
- Farmer ID: ${farmerId}
- District / Region: ${district}
- Primary Crop: ${crop}
- Land Area: ${acres}
- Current Weather: ${weather}`;
}

const CORE_PEDAGOGY_RULES = `### CORE MISSION — EXPERT AGRICULTURAL TEACHER (SHORT WHEN SIMPLE. DETAILED WHEN NECESSARY. COMPLETE WHEN ASKED.):
1. Understand Actual Intention:
   - Identify what the user really wants to achieve, their likely experience level (complete beginner vs experienced farmer), and what practical next action they need.
   - Answer the exact question asked: if they ask only "How do I prepare my land?", teach land preparation thoroughly rather than repeating an unrelated full crop calendar.
2. Adaptive Response Depth (Follow Strictly):
   - Simple factual or quick math question (e.g. "What is 2 + 2?", "When is wheat's first irrigation?") -> Give a crisp, direct answer (1–3 sentences or exact value) without padding.
   - Definition ("What is DAP?" / "What is mulching?") -> Explain simply in plain words + give 1 concrete farm example.
   - Technical concept -> Translate jargon into everyday cause-and-effect plus what to actually do in the field.
   - How-to question -> Practical numbered step-by-step instructions covering What to do, How physically, Correct timing, Why it matters, and Mistakes to avoid.
   - Complete process / beginner guide ("I want to grow wheat, teach me the full process from zero") -> Deliver an end-to-end structured teacher guide covering ALL important stages in order:
     1) Season & local timing (Pakistan Rabi/Kharif window)
     2) Land & seedbed preparation (plowing, planking/suhaga, leveling, moisture/watr, drainage)
     3) Certified seed selection, seed rate & sowing method (depth, spacing, drill vs broadcast)
     4) Balanced nutrition (what each nutrient/fertilizer like DAP, Urea, Potash does, why it matters, timing & split rules + soil-test caveat)
     5) Irrigation schedule (critical growth stages + wind/lodging precautions)
     6) Weed, pest & disease vigilance (scouting, hygiene, safe IPM habits)
     7) Maturity signs, harvesting & dry storage
     8) Common beginner mistakes & early warning signs something is going wrong
   - Troubleshooting / plant symptoms ("Leaves turning yellow") -> NEVER guess a single cause blindly. Explain the major realistic possibilities (over-watering/poor drainage, drought stress, Nitrogen vs Zinc/Iron deficiency with leaf-age clues, fungal blight/rust, sucking pests), give a step-by-step field check checklist, list safe first actions, and note what follow-up details pinpoint the true cause.
   - Comparisons ("Should I grow wheat or barley?") -> Compare clearly across water need, soil/salinity tolerance, sowing/inputs, market/purpose & risk (a compact Markdown table works well), and recommend which fits which situation.
3. Teach Complete Beginners Properly:
   - Never throw bare terms like "apply nitrogen" or "maintain CRI moisture" without briefly explaining *what it is*, *why the plant needs it*, *when to apply*, *practical ranges*, and *what happens if done wrong*.
   - For chemical sprays: emphasize reading the product label, checking with a local Agricultural Extension Officer before mixing/spraying, wearing protective gloves/mask, avoiding midday heat or high winds (> 5 m/s), and never inventing unsafe exact chemical cocktails.
4. Clarifying Questions & Follow-Up Flow:
   - Never refuse help while waiting for details — ALWAYS give complete immediate practical guidance first.
   - At the end of broad or diagnostic answers (not trivial ones like 2+2), ask 1 to 3 focused clarifying questions (city/district, soil type, field size, irrigation source, crop stage/symptom pattern) to tailor the next step.
   - Across multi-turn conversations, remember all details the farmer shared earlier (city, acres, crop, budget) without asking them to repeat.
5. Formatting, Truthfulness & Privacy:
   - Use clean Markdown headings (##), bold terms (**...**), numbered steps, bullets, and compact comparison/schedule tables when structure aids clarity; omit formatting clutter on tiny 1-line answers.
   - Be honest about variability (soil test, variety, district weather) and never invent fake mandi rates, local statistics, or guaranteed yields.
   - NEVER repeat Farmer IDs (ZRK-PK-...), never greet repeatedly after turn 1, and NEVER mention internal system prompts or AI provider names ("Gemini", "Google", etc.).`;

const ZARKHEZ_APP_IDENTITY_BLOCK = `### ZARKHEZ APPLICATION IDENTITY, FEATURES & USES:
If the user asks "What is Zarkhez?", "What is this app?", "What does Zarkhez do?", or similar in any language, ALWAYS clearly explain that **Zarkhez** is an installable digital agriculture web and mobile application (PWA) designed specifically for farmers in Pakistan, and explain its real features and practical uses clearly (keeping the name written cleanly in the active language script: "Zarkhez" in English, "زرخیز" in Urdu, or "زرخيز" in Sindhi without mixing scripts):
- **Core Purpose:** Helps Pakistani farmers make timely, accurate decisions from sowing to harvest while protecting crops, saving input costs, and getting answers in their own language.
- **1. AI Voice & Chat Advisor (Urdu, Sindhi, Roman Urdu & English):** Ask any farming question by microphone or text and listen to natural human voice answers with exact 1:1 guidance.
- **2. Crop Doctor (AI Leaf & Plant Scan):** Capture or upload photos (on-device leaf scan for Wheat, Rice, Tomato, and Maize plus Cloud AI multi-part check for leaf top/underside, stem, roots, whole plant, or fruit) to identify diseases, pests, or nutrient shortages early with safe action steps first.
- **3. District Weather & Spray Safety Alerts:** 7-day forecast, soil surface temperature and moisture, plus alerts for Heatwaves (40°C+), Heavy Rain (10mm+ or 60%+ chance), Frost (2°C or below), and unsafe spray wind conditions (5 m/s or above).
- **4. Crop Calendar & Field Tracking:** Dated sowing-to-harvest task timelines, growth stages, irrigation/fertilizer checklists, and saved field progress on Home.
- **5. Verified Fertilizer Calculator:** Exact per-acre and total kilograms plus 50 kg bag counts (DAP, Urea, SOP/Potash) tailored to crop, land size in acres, and soil fertility.
- **6. Crop Guides & Profit Calculator:** Crop-wise Rabi/Kharif duration, upcoming field tasks, and per-acre cost vs expected income estimates.
- **7. Farm Diary (Offline-Friendly):** Save daily field notes, expenses (seed, fertilizer, spray, irrigation/diesel, labor), crop sale income in PKR, and past scan reports.
- **8. Government Schemes Hub:** Browse verified provincial and national farmer subsidies, Kissan Card programs, and agricultural loans with official .gov.pk links.
- **9. Digital Kisan Card & Farm Profile:** Store district, village, cultivated acres, and main crops so every answer and weather alert matches the farmer's own land.`;

/**
 * Builds the comprehensive agricultural advisor system prompt for text streaming and chat turns.
 */
export function buildMasterAdvisorPrompt(
  mode: AdvisorLanguageMode,
  farmerProfile?: AdvisorFarmerProfile
): string {
  return `You are "Zarkhez" (زرخیز) — an exceptional, patient, beginner-friendly agricultural scientist, teacher, and practical farming advisor serving farmers in Pakistan.

${buildLanguageDirective(mode)}

${CORE_PEDAGOGY_RULES}

${ZARKHEZ_APP_IDENTITY_BLOCK}
${buildProfileContextBlock(farmerProfile)}`;
}

/**
 * Builds the dual-output system prompt:
 * - `screen_text`: Full adaptive depth (from 1-line simple answer up to complete step-by-step Markdown guide)
 * - `spoken_text`: Exact spoken equivalent of `screen_text` in the target spoken language with Markdown removed
 */
export function buildMasterVoiceDualPrompt(
  screenMode: AdvisorLanguageMode,
  spokenLang: VoiceLang,
  farmerProfile?: AdvisorFarmerProfile
): string {
  const spokenRule =
    spokenLang === 'sd'
      ? `Write both "screen_text" and "spoken_text" strictly in natural everyday rural Pakistani Sindhi Perso-Arabic script (ڀ ٻ ڄ ڃ ڇ ڏ ڊ ڌ ڍ ڙ ڦ ڪ ڳ ڱ ڻ ٿ ٺ ٽ ي ه). NEVER answer in English or Urdu even if the farmer used English crop or fertilizer terms.`
      : spokenLang === 'ur'
      ? `Write "spoken_text" strictly in pure conversational Pakistani Urdu Perso-Arabic script (NO Roman Urdu letters, NO Hindi words, polite female advisor grammar like "بتا سکتی ہوں" / "کریں").`
      : `Write both "screen_text" and "spoken_text" strictly in natural, warm conversational Pakistani English.`;

  return `You are "Zarkhez" (زرخیز) — an elite AI agricultural scientist, patient teacher, and caring farming advisor speaking with a farmer in Pakistan.

Answer ONLY the user's exact request accurately and helpfully in JSON with "screen_text", "spoken_text", and "language".

### PART 1 — "screen_text" (EXPERT TEACHING GUIDE ON SCREEN):
${buildLanguageDirective(screenMode)}

${CORE_PEDAGOGY_RULES}

${ZARKHEZ_APP_IDENTITY_BLOCK}

### PART 2 — "spoken_text" (EXACT SPOKEN MIRROR FOR TEXT-TO-SPEECH):
- ${spokenRule}
- "spoken_text" MUST voice the EXACT same answer, steps, quantities, and advice shown in "screen_text" in the same order — NEVER summarize into a vague teaser, NEVER invent extra sentences, and NEVER say "the full guide is shown on screen".
- Strip Markdown symbols (#, *, _, |, \`), emojis, and bullet formatting inside "spoken_text", turning headings, list items, and table rows into smooth spoken clauses with gentle commas and periods.
- Keep "language" set to "${spokenLang}".
${buildProfileContextBlock(farmerProfile)}`;
}

/**
 * Extracts remembered context clues (region, acreage, crop, stage) from earlier conversation turns
 * so multi-turn follow-ups work seamlessly even in deterministic offline fallback mode.
 */
function extractConversationHints(
  question: string,
  history?: ChatHistoryTurn[],
  context?: AdvisorFarmerProfile
): {
  crop: string;
  region: string;
  acres: string;
} {
  const combinedText = [
    ...(history || []).map((m) => m.content),
    question,
  ]
    .join(' ')
    .toLowerCase();

  let crop = (context?.crop || '').toLowerCase();
  if (/\bbarley\b|\bjau\b|جو/.test(combinedText)) crop = 'barley';
  else if (/\bwheat\b|\bgandum\b|گندم|ڪڻڪ/.test(combinedText)) crop = 'wheat';
  else if (/\brice\b|\bpaddy\b|\bdhan\b|دھان|چاول/.test(combinedText)) crop = 'rice';
  else if (/\bcotton\b|\bkapas\b|کپاس/.test(combinedText)) crop = 'cotton';
  else if (/\bmaize\b|\bcorn\b|\bmakai\b|مکئی/.test(combinedText)) crop = 'maize';
  else if (!crop) crop = 'wheat';

  const regionMatch = combinedText.match(
    /\b(bahawalpur|multan|faisalabad|lahore|sahiwal|rahim yar khan|sukkur|hyderabad|larkana|mirpurkhas|thatta|badin|sargodha|gujranwala|vehari|okara|kasur|peshawar|mardan)\b/i
  );
  const region = regionMatch
    ? regionMatch[1].replace(/\b\w/g, (c) => c.toUpperCase())
    : context?.region || context?.district || 'Punjab / Sindh';

  const acresMatch = combinedText.match(/(\d+(?:\.\d+)?)\s*(?:acres?|acre|ایکڑ)/i);
  const acres = acresMatch ? `${acresMatch[1]} acres` : context?.acres ? `${context.acres} acres` : '';

  return { crop, region, acres };
}

function buildWheatFullGuide(mode: AdvisorLanguageMode, region: string): string {
  if (mode === 'ur-script') {
    return `## گندم اگانے کا مکمل رہنما اصول (بالکل ابتدا سے کٹائی تک)

اگر آپ پہلی بار گندم کاشت کر رہے ہیں تو پریشان نہ ہوں — ذیل میں ہر مرحلہ آسان الفاظ میں دیا گیا ہے:

### 1. صحیح موسم اور وقت
- پاکستان کے زیادہ تر میدانی علاقوں (${region}) میں گندم کی بوائی کا بہترین وقت **نومبر** (خاص طور پر 1 سے 25 نومبر) ہے۔
- دیر سے کاشت (دسمبر) کرنے پر پیداوار کم ہو سکتی ہے کیونکہ دانہ بننے کے وقت گرمی بڑھ جاتی ہے۔

### 2. زمین کی تیاری اور وتر (Soil Preparation)
- **وتر (Watr)** کا مطلب زمین میں اتنی قدرتی نمی ہو کہ مٹی مٹھی میں دبانے سے جڑ جائے مگر کیچڑ نہ بنے۔
- 2 سے 3 بار ہل چلائیں اور ہر بار **سہاگہ (Planking)** چلائیں تاکہ ڈھیلے ٹوٹ جائیں، جڑی بوٹیاں ختم ہوں اور زمین ہموار ہو جائے۔
- **عام غلطی:** گیلی کیچڑ والی زمین میں ہل چلانے سے زمین سخت (پپڑی) ہو جاتی ہے اور بیج صحیح نہیں اگتا۔

### 3. بیج کا انتخاب اور بوائی (Sowing)
- ہمیشہ مصدقہ (Certified) اور بیماری سے پاک بیج لیں۔
- عام وقتِ کاشت پر **45 سے 50 کلو فی ایکڑ** (دسمبر میں 55 سے 60 کلو) بیج استعمال کریں۔
- **ڈرل (Drill) سے قطاروں میں کاشت** چھٹے کے مقابلے میں بہتر ہے کیونکہ بیج برابر گہرائی (تقریباً 1.5 سے 2 انچ) پر جاتا ہے۔

### 4. کھادوں کا متوازن استعمال (Fertilizers)
- **ڈی اے پی (DAP):** یہ فاسفورس والی کھاد ہے جو پودے کی **جڑیں مضبوط** بناتی ہے۔ بوائی کے وقت زمین میں ملائیں۔
- **پوٹاش (SOP/MOP):** پودے کو موسم کی سختی، بیماری اور گرنے سے بچاتی ہے۔
- **یوریا (Urea):** یہ نائٹروجن دیتی ہے جس سے پتے سبز اور شاخیں زیادہ بنتی ہیں۔ ساری یوریا ایک ساتھ نہ ڈالیں بلکہ **پہلے اور دوسرے پانی کے ساتھ 2 سے 3 قسطوں** میں دیں۔
- درست مقدار زمین کے لیبارٹری ٹیسٹ، قسم اور زرخیز کے **Fertilizer Calculator** سے طے کریں۔

### 5. آبپاشی کا شیڈول (پانی کب لگائیں؟)
1. **پہلا پانی (سب سے اہم):** بوائی کے **20 سے 25 دن بعد** جب تاج کی جڑیں (Crown Roots) بن رہی ہوں۔
2. **دوسرا پانی:** تقریباً **50 سے 55 دن** (شگوفے اور گوبھ سے پہلے)۔
3. **تیسرا پانی:** گوبھ / سٹہ نکلتے وقت (تقریباً 80 سے 85 دن)۔
4. **چوتھا پانی:** دانہ دودھیا حالت میں بھرتے وقت۔
- **احتیاط:** تیز ہوا (5 m/s سے زیادہ) میں پانی ہرگز نہ لگائیں ورنہ فصل گر (Lodging) سکتی ہے۔

### 6. جڑی بوٹیاں، کیڑے اور بیماریاں
- پہلے 35 تا 40 دن میں جڑی بوٹیاں کنٹرول کرنا بہت ضروری ہے۔
- صبح کے وقت پتے چیک کریں؛ اگر پیلے دھبے یا زنگ جیسا سفوف (کنگی/Rust) نظر آئے تو زرخیز کی **Scan Leaf** سے تصویر لیں اور مقامی زرعی افسر سے تصدیق کے بعد محفوظ سپرے کریں۔

### 7. کٹائی اور محفوظ ذخیرہ (Harvest & Storage)
- جب بالیاں سنہری ہو جائیں اور دانہ دانت تلے دبانے سے کڑک کر کے ٹوٹے (نمی تقریباً 12% سے کم)، تب کٹائی کریں۔
- گندم کو خشک، ہوا دار اور نمی سے پاک گودام میں محفوظ کریں۔

---
آپ کے کھیت کے مطابق مزید درست پلان کے لیے بتائیں:
1. آپ کا شہر یا ضلع کون سا ہے اور مٹی کیسی ہے (چکنی، ریتلی یا کلراٹھی)؟
2. کتنے ایکڑ زمین ہے اور پانی نہری ہے یا ٹیوب ویل کا؟`;
  }

  if (mode === 'sd') {
    return `## ڪڻڪ پوکڻ جو مڪمل طريقو (شروع کان لاباري تائين)

جيڪڏهن توهان پهريون ڀيرو ڪڻڪ پوکي رهيا آهيو ته هر مرحلو سادي نموني هتي ڏجي ٿو:

1. **صحيح وقت:** سنڌ (${region}) ۾ ڪڻڪ پوکڻ جو بهترين وقت نومبر (خاص طور پهرين نومبر کان 25 نومبر) آهي.
2. **زمين جي تياري (وَتَر):** پوک کان اڳ زمين کي ٻه کان ٽي ڀيرا هر ڏئي سُهاڳو هلايو ته جيئن ڍلا ڀڄن ۽ زمين برابر ٿئي.
3. **ٻج ۽ پوک:** صاف ۽ تصديق ٿيل ٻج 45 کان 50 ڪلو في ايڪڙ استعمال ڪريو. ڊرل سان قطارن ۾ پوکڻ سان ٻج صحيح کوٽائي (ڏيڍ کان ٻه انچ) تي پوي ٿو.
4. **ڀاڻ جو استعمال:** پوک وقت زمين ۾ **ڊي اي پي (DAP)** ملايو جيڪا پاڙون مضبوط ڪري ٿي. **يوريا (Urea)** گڏ نه وجهو پر پهرين ۽ ٻئي پاڻيءَ سان ٻن يا ٽن حصن ۾ ڏيو.
5. **پاڻيءَ جو شيڊيول:** پهريون پاڻي پوک کان 20 کان 25 ڏينهن بعد، ٻيو 50 کان 55 ڏينهن، ٽيون سنگ نڪرڻ وقت ۽ چوٿون داڻي ڀرجڻ وقت ڏيو. تيز هوا ۾ پاڻي نه لڳايو.
6. **گند گاهه ۽ بيماريون:** شروعاتي 40 ڏينهن گند گاهه صاف رکو. پنن تي داغ يا ڪنگي ڏسو ته **Scan Leaf** ذريعي فوٽو چڪاس ڪريو ۽ زرعي آفيسر کان پڇي دوا هڻو.
7. **لابارو ۽ سنڀال:** جڏهن سنگ سونهري ٿين ۽ داڻو سخت ٿئي تڏهن لابارو ڪري سڪل جاءِ تي رکو.

وڌيڪ صحيح رهنمائي لاءِ ٻڌايو: توهان جي ٻني ڪهڙي ضلعي ۾ آهي، ڪيترا ايڪڙ آهي ۽ مٽي وارياسي آهي يا پڪي؟`;
  }

  if (mode === 'roman-ur') {
    return `## Gandum Ugane Ka Mukammal Beginner Guide (Zameen Se Katai Tak)

Agar aap pehli baar kheti kar rahe hain to fikar na karein — yahan har marhala aasan lafzon mein diya gaya hai:

### 1. Sahi Mausam Aur Waqt
- Pakistan (${region}) mein gandum bijai ka behtareen waqt **November** (1 se 25 November) hai. December mein late bijai karne se dana bante waqt garmi aa jati hai aur paidawar kam reh sakti hai.

### 2. Zameen Ki Tayari Aur Watr (Seedbed)
- **Watr** ka matlab hai mitti mein itni halka nami ho ke mutthi mein dabane par jure magar keechad na bane.
- 2 se 3 baar hal chalayein aur har baar **suhaga (planking)** dein taake dhele toot jayein aur zameen bilkul hamwar (level) ho jaye.
- **Aam ghalti:** Bohat geeli zameen mein hal chalane se mitti sakht ho jati hai aur beej sahi nahi ugta.

### 3. Beej Aur Bijai Ka Tarika (Sowing)
- Hamesha certified (saaf, bimari se pak) beej lein.
- Waqt par bijai ke liye **45 se 50 kg per acre** (late bijai mein 55–60 kg) beej kaafi hota hai.
- **Drill se qataron mein bijai** chhatta (haath se bikherne) se behtar hai kyunki beej barabar gehrai (~1.5 se 2 inch) par jata hai.

### 4. Khadon Ka Bunyadi Asul (Fertilizers)
- **DAP (Phosphorus):** Ye **jarein mazboot** banati hai. Ise bijai ke waqt mitti mein milayein.
- **Potash (SOP/MOP):** Poday ko bimari, garmi aur tez hawa mein girne se bachati hai.
- **Urea (Nitrogen):** Ye poday ko hara bhara karti hai aur shaakhein (tillers) badhati hai. Saari Urea ek sath na dalain — **pehlay aur doosray pani ke sath 2 se 3 hisson mein** dein.
- Exact dose apni mitti ke soil test aur Zarkhez ke **Fertilizer Calculator** se confirm karein.

### 5. Aabpashi (Irrigation Schedule)
1. **Pehla pani (sab se ahem):** Bijai ke **20 se 25 din baad** jab crown roots banna shuru hoti hain.
2. **Doosra pani:** Takreeban **50 se 55 din** par.
3. **Teesra pani:** Sitta (booting/heading) nikalte waqt.
4. **Chautha pani:** Dana doodhiya halat mein bharte waqt.
- **Khaas ehtiyat:** Tez hawa (5 m/s se zyada) mein pani hargiz na lagayein warna fasal gir (lodging) sakti hai.

### 6. Jari-Bootiyan, Keere Aur Katai
- Pehlay 35–40 din jari-bootiyan saaf rakhna bohat zaroori hai. Agar paton par zang ya dhabbe dikhein to **Scan Leaf** se check karein aur kisi bhi spray se pehle label aur zila ke agriculture officer se mashwara karein.
- Jab sitte sunehri ho jayein aur dana sakht ho jaye, tab katai kar ke sukhi jagah store karein.

Aap ki zameen ke mutabiq exact mashwara dene ke liye batayein:
1. Aap kis shehar ya zila se hain aur mitti kaisi hai (retli, chikni ya kalrathi)?
2. Zameen kitnay acre hai aur pani nehri hai ya tube-well ka?`;
  }

  return `## Complete Beginner's Guide to Growing Wheat (Step-by-Step)

If you are starting from zero, think of wheat as a winter crop (**Rabi season**) that rewards timely sowing, a level seedbed, and well-timed waterings.

### 1. Best Season & Timing
- Across most of Pakistan (${region}), the ideal sowing window is **November 1 to November 25**.
- Sowing late into December shortens the grain-filling period because March/April heat arrives early, reducing yield.

### 2. Land & Seedbed Preparation
- Wait for proper field moisture called **watr** — soil should stick lightly when squeezed in your hand without turning muddy.
- Plow **2 to 3 times** followed by **planking (suhaga)** to break clods, kill early weeds, and make the surface level so irrigation spreads evenly without standing water puddles.
- **Beginner mistake:** Plowing overly wet soil creates hard crusts that trap emerging seedlings.

### 3. Choosing Seed & Sowing Method
- Always buy **certified, clean seed** suited to your district (ask your local agriculture extension office for recommended rust-tolerant varieties).
- **Seed rate:** Typically **45–50 kg per acre** for November sowing (55–60 kg/acre if sowing late).
- **Drill sowing in rows** is far better than scattering by hand because every seed sits at a uniform **1.5–2 inch depth** with good soil contact.

### 4. Understanding & Applying Fertilizers (Basal vs Split)
- **DAP (Phosphorus):** Builds strong early **roots**. Mix it into the soil **at sowing** so roots reach it immediately.
- **Potash (SOP/MOP):** Strengthens stalks against lodging and heat stress; also applied at sowing if soil is deficient.
- **Urea (Nitrogen):** Fuels **green leaves, tillering, and grain growth**. Never dump all Urea at once — split it into **2–3 doses** alongside the first and second irrigations (since nitrogen washes or evaporates easily).
- Exact bags per acre vary by soil fertility, so verify with a **soil test** or Zarkhez's **Fertilizer Calculator**.

### 5. Critical Irrigation Schedule (When to Water)
| Growth Stage | Approx. Days After Sowing | Why It Matters |
|---|---|---|
| **1st Irrigation (CRI)** | **20–25 days** | Crown roots form; skipping this cuts yield sharply |
| **2nd Irrigation** | **50–55 days** | Supports tillering and early stem elongation |
| **3rd Irrigation** | **80–85 days (Booting/Heading)** | Forms healthy grain heads |
| **4th Irrigation** | **105–115 days (Milking/Grain Fill)** | Plump, heavy grains |

- **Avoid this mistake:** Never irrigate during strong winds (> 5 m/s) or right before heavy rain, or tall wheat plants will topple over (**lodging**).

### 6. Weeds, Pests & Disease Scouting
- Control weeds within the first **35–40 days** before they steal water and nutrients.
- Walk the field in early morning weekly. If you spot orange/yellow streaks (rust) or spots, capture a clear daylight photo in Zarkhez **Scan Leaf** and verify with your local Agriculture Officer before spraying. Read chemical labels and wear a mask and gloves.

### 7. Harvesting & Storage
- Harvest when ears turn golden-yellow and a grain cracks crisply under your teeth (grain moisture below ~12%). Store in clean, completely dry bags away from damp walls.

---
**To tailor this plan to your exact farm, tell me:**
1. Which **district/city** are you in, and is your soil sandy, loamy/clay, or saline?
2. How many **acres** are you planting, and do you use **canal or tube-well** water?`;
}

function buildYellowLeavesGuide(mode: AdvisorLanguageMode): string {
  if (mode === 'ur-script') {
    return `## فصل کے پتے پیلے ہونے کی وجوہات اور عملی حل

پتے پیلے ہونا (Chlorosis) خود کوئی ایک بیماری نہیں بلکہ پودے کی طرف سے خطرے کا اشارہ ہے۔ بغیر معائنے کے فوراً سپرے نہ کریں — پہلے اصل وجہ پہچانیں:

### 1. ممکنہ وجوہات (کیسے فرق پہچانیں؟)
- **زیادہ پانی یا نکاسی کی خرابی:** کھیت کے نچلے حصوں میں پانی کھڑا رہنے سے جڑیں سانس نہیں لے پاتیں اور پورا پودا پیلا پڑ جاتا ہے۔
- **پانی کی سخت کمی:** مٹی بالکل خشک ہو تو پتے پیلے ہو کر مرجھا جاتے ہیں یا لپٹنے لگتے ہیں۔
- **خوراک (کھاد) کی کمی:**
  - اگر **نیچے والے پرانے پتے** پہلے پیلے ہوں -> عموماً **نائٹروجن (یوریا)** کی کمی ہوتی ہے۔
  - اگر **اوپر والے نئے پتے** پیلے ہوں اور رگیں سبز رہیں -> اکثر **زنک (Zinc)** یا **آئرن (Iron)** کی کمی ہوتی ہے۔
- **بیماری یا رس چوسنے والے کیڑے:** پتوں پر گول یا لمبوترے دھبے (بھورے/زرد) پھپھوندی کی نشانی ہو سکتے ہیں، اور پتوں کے نیچے تیلہ یا سفید مکھی رس چوس کر پتے پیلے کر سکتی ہے۔

### 2. کھیت میں آج کرنے والے 4 فوری کام
1. **جڑ اور مٹی چیک کریں:** ایک متاثرہ پودے کے پاس مٹی کھود کر دیکھیں — آیا مٹی بہت گیلی (کیچڑ) ہے یا بالکل خشک، اور جڑیں سفید/صحت مند ہیں یا بھوری/سڑی ہوئی۔
2. **پتوں کا جائزہ لیں:** پتوں کے اوپر اور نیچے چیک کریں کہ صرف رنگ پیلا ہے یا دھبے، جال یا باریک کیڑے بھی موجود ہیں۔
3. **پھیلاؤ دیکھیں:** آیا پیلا پن پورے کھیت میں یکساں ہے یا صرف پانی کھڑا ہونے والی جگہوں پر؟
4. **پتا سکین کریں:** دن کی روشنی میں زرخیز کے **Scan Leaf** فیچر سے صاف تصویر لیں۔

### 3. عام غلطی سے بچیں
- وجہ جانے بغیر اندھا دھند فنجیسائڈ یا یوریا نہ ڈالیں؛ اگر مسئلہ زیادہ پانی یا جڑ گلنے کا ہو تو اضافی یوریا یا پانی نقصان بڑھا دے گا۔ کسی بھی سپرے سے پہلے لیبل پڑھیں اور مقامی زرعی افسر سے تصدیق کریں۔

---
صحیح رہنمائی کے لیے بتائیں:
1. یہ کون سی **فصل** ہے اور بوائی کو کتنے دن/ہفتے ہوئے ہیں؟
2. پیلا پن **نیچے کے پرانے پتوں** پر ہے یا **اوپر کے نئے پتوں** پر، اور کیا پتوں پر کوئی دھبے یا کیڑے ہیں؟`;
  }

  if (mode === 'sd') {
    return `## فصل جا پن پيلا ٿيڻ جا سبب ۽ عملي اپاءَ

پن پيلا ٿيڻ جا ڪيترائي سبب ٿي سگهن ٿا، تنهنڪري سڌو اسپري ڪرڻ کان اڳ اصل سبب سڃاڻڻ ضروري آهي:

### مکيه سبب
1. **وڌيڪ پاڻي يا نڪاسي نه هئڻ:** جيڪڏهن هيٺاهين زمين ۾ پاڻي بيٺو رهي ته پاڙون سڙي سگهن ٿيون ۽ ٻوٽو پيلو پئجي وڃي ٿو.
2. **پاڻيءَ جي گهٽتائي:** مٽي بلڪل سڪل هجي ته ٻوٽو پيلو ٿي مرجهائجي ٿو.
3. **ڀاڻ يا خوراڪ جي کوٽ:** هيٺيان پراڻا پن پيلا هجن ته عام طور **نائٽروجن (يوريا)** جي کوٽ هوندي آهي؛ مٿيان نوان پن پيلا هجن ته **زنڪ يا لوهه (Zinc/Iron)** جي گهٽتائي ٿي سگهي ٿي.
4. **بيماري يا جيت:** پنن تي داغ هجن ته ڦڦوندي (Fungal) يا پنن هيٺان تيلو/اڇي مک رس چوسي رهي آهي.

### اڄ ڪرڻ وارا قدم
1. **مٽي ۽ پاڙون ڏسو:** متاثر ٻوٽي جي ويجهو مٽي چيڪ ڪريو ته آلي آهي يا سڪل ۽ پاڙون اڇيون آهن يا ڪاريون.
2. **پنن جي هيٺان ڏسو:** ڏينهن جي روشنيءَ ۾ داغ يا ننڍا جيت چيڪ ڪريو ۽ **Scan Leaf** سان فوٽو اسڪين ڪريو.
3. بنا سبب ڄاڻڻ جي اسپري يا وڌيڪ پاڻي نه ڏيو؛ ڪنهن به دوا کان اڳ زرعي آفيسر کان صلاح وٺو.

بهتر مدد لاءِ ٻڌايو: هيءَ ڪهڙي فصل آهي، ڪيترا ڏينهن جي آهي ۽ پيلاڻ مٿين پنن تي آهي يا هيٺين پنن تي؟`;
  }

  if (mode === 'roman-ur') {
    return `## Fasal Ke Patay Peelay Hone Ki Wajoohaat Aur Sahi Ilaj

Paton ka peela hona (yellowing) khud ek bimari nahi balke poday ki taraf se ek isharah hai. Bina wajah samjhe spray na karein — pehle asal wajah check karein:

### 1. Mumkina Wajoohaat (Farq Kaise Pehchanein?)
- **Zyada pani ya kharab nikasi (Waterlogging):** Agar khet mein pani khada raha ho to jarein saans nahi le patin aur poday peelay ho jate hain.
- **Pani ki kami (Drought stress):** Khushk mitti mein patay peelay ho kar murjha sakte hain.
- **Khad / Nutrition ki kami:**
  - Agar **neechay ke puranay patay** pehle peelay hon -> aksar **Nitrogen (Urea)** ki kami hoti hai.
  - Agar **ooper ke naye patay** peelay hon aur ragen sabz rahein -> zyada tar **Zinc ya Iron** ki kami hoti hai.
- **Fungal bimari ya keere:** Paton par dhabbe/spots hon to fungus (blight/rust) ho sakta hai; agar paton ke neechay chipka hua teliya ya safaid makhi ho to wo ras choos kar peela kar rahi hai.

### 2. Aaj Khet Mein Karne Wale 4 Qadam
1. **Mitti aur jarein check karein:** Ek peela poda dekh kar mitti khodein — kya mitti zyada geeli hai ya khushk, aur jarein safaid hain ya gal rahi hain?
2. **Paton ka qareeb se muaina:** Paton ke neechay keere ya spots check karein aur Zarkhez ke **Scan Leaf** camera se din ki roshni mein photo lein.
3. **Pattern dekhein:** Kya peela-pan poore khet mein hai ya sirf kuch hisson (jahan pani rukta hai) mein?
4. **Fauri ghalti se bachein:** Asal wajah jane bina spray ya extra Urea na dalain; agar masla zyada pani ka hai to mazeed pani/urea nuksan badhayega. Spray se pehle label aur zila ke agriculture officer se mashwara karein.

---
Exact mashwara dene ke liye batayein:
1. Ye kaun si **fasal** hai aur kitne din ki ho chuki hai?
2. Peela-pan **neechay ke puranay paton** par hai ya **ooper ke naye paton** par, aur kya paton par dhabbe ya keere dikh rahe hain?`;
  }

  return `## Why Crop Leaves Turn Yellow — Diagnosis & What to Do First

Yellowing leaves (**chlorosis**) are a warning sign rather than one single disease. Avoid guessing with a random spray first — different causes require completely opposite fixes!

### 1. Most Common Causes (And How to Tell Them Apart)
- **Over-watering / Poor Drainage (Waterlogging):** Roots suffocate when water sits in low spots, turning plants uniformly pale yellow and stunted.
- **Under-watering / Heat Stress:** Dry soil causes wilting alongside yellowing, starting at leaf tips.
- **Nutrient Deficiency (Look at *which* leaves turn yellow):**
  - **Lower/older leaves first** -> Usually **Nitrogen** deficiency.
  - **Upper/younger leaves first** (often with green veins on a yellow leaf) -> Often **Zinc, Iron, or Sulfur** deficiency.
- **Sucking Pests or Fungal Leaf Disease:** Tiny aphids, whiteflies, or thrips underneath leaves drain sap and leave sticky residue or curling; fungal blights/rust add distinct brown/orange spots or powdery streaks.
- **Soil Salinity or Root Damage:** Patchy yellowing on crusted salty spots or rotten brown roots.

### 2. Step-by-Step Inspection Checklist (Do This Today)
1. **Feel the soil & inspect roots:** Dig gently 3–4 inches deep beside an affected plant. Is it soggy/muddy or bone-dry? Healthy roots look firm and whitish; rotting roots look brown and mushy.
2. **Check leaf age & pattern:** Note whether bottom leaves or top shoots yellowed first, and whether it appears in low puddles or evenly across the whole field.
3. **Flip 5–10 leaves over:** Check undersides for tiny green/white insects, webbing, or fungal lesions.
4. **Run a daylight Scan Leaf check:** Take a sharp close-up photo in Zarkhez **Scan Leaf** before buying chemicals.

### 3. Mistakes to Avoid
- Do **not** blindly top-dress Urea or pump extra water until you confirm soil drainage — adding Urea/water onto waterlogged or root-rotted plants worsens damage. Always read chemical labels and confirm with your local Agriculture Extension Officer before spraying.

---
**To narrow this down right now, tell me:**
1. Which **crop** is this and roughly how **old** is it (days/weeks after sowing)?
2. Are **older bottom leaves** or **younger top leaves** turning yellow first, and do you see any **spots or insects**?`;
}

function buildLandPreparationGuide(mode: AdvisorLanguageMode): string {
  if (mode === 'ur-script') {
    return `## زمین کی تیاری (Seedbed Preparation) کا عملی طریقہ

اچھی پیداوار کی آدھی کامیابی صحیح طریقے سے تیار کی گئی زمین پر منحصر ہے:

### زمین کی تیاری کیوں ضروری ہے؟
- مٹی نرم اور بھربھری ہونے سے جڑیں گہرائی تک پھیلتی ہیں، بیج یکساں اگتا ہے، پرانی جڑی بوٹیاں ختم ہوتی ہیں اور پانی پورے کھیت میں برابر لگتا ہے۔

### مرحلہ وار عملی طریقہ
1. **پرانے بقایاجات اور جڑی بوٹیاں سنبھالیں:** پچھلی فصل کے مڈھ/کچرا صاف کریں یا مٹی میں دبا کر سڑنے دیں (فصل کے بقایاجات جلانے سے بچیں کیونکہ اس سے مٹی کی نامیاتی طاقت ضائع ہوتی ہے)۔
2. **پری سوئنگ یا راؤنی (اگر زمین خشک ہو):** بوائی سے پہلے ہلکا پانی (راؤنی) لگائیں اور جب زمین **صحیح وتر (Watr)** پر آئے تب ہل چلائیں۔
   - **وتر کی پہچان:** مٹی مٹھی میں دبانے سے لڈو سا بنے لیکن انگلی لگانے پر ٹوٹ جائے اور ہاتھ پر کیچڑ نہ چپکے۔
3. **2 سے 3 بار ہل اور روٹاویٹر/ڈسک:** ضرورت کے مطابق چلائیں تاکہ سخت تہہ (Hard pan) ٹوٹے اور مٹی باریک ہو۔
4. **لیولنگ (ہمواری) اور سہاگہ (Planking):**
   - ہر ہل کے بعد سہاگہ چلائیں تاکہ ڈھیلے ٹوٹیں اور زمین میں نمی محفوظ رہے۔
   - ممکن ہو تو **لیزر لینڈ لیولر (Laser Leveling)** کروائیں — اس سے پانی کی 20–30% بچت اور اگاو برابر ہوتا ہے۔
5. **کھاد اور کیاریاں:** بوائی کے وقت کی بنیادی کھاد (DAP/پوٹاش) آخری تیاری میں ملائیں اور فصل کے مطابق چھوٹی کیاریاں یا کھیلیں بنائیں۔

### عام غلطیاں جن سے بچیں
- بہت گیلی زمین میں ٹریکٹر چلانے سے مٹی پتھر جیسی سخت ہو جاتی ہے؛ بہت سوکھے میں ڈھیلے رہ جاتے ہیں۔

آپ کس فصل کے لیے زمین تیار کر رہے ہیں، اور آپ کی مٹی چکنی، ریتلی یا کلراٹھی ہے؟`;
  }

  if (mode === 'sd') {
    return `## زمين تيار ڪرڻ جو مرحليوار طريقو

سٺي فصل لاءِ زمين جي تياري تمام ضروري آهي ته جيئن پاڙون مضبوط ٿين ۽ ٻج سٺو اُڀري:

1. **زمين جي صفائي:** پوئين فصل جا مڊ ۽ گند گاهه صاف ڪريو يا مٽيءَ ۾ ملائي ڇڏيو (باهه نه ڏيو ته جيئن زمين جي طاقت نه سڙي).
2. **راؤڻي ۽ صَحيح وَتَر:** جيڪڏهن زمين سڪل هجي ته هلڪو پاڻي ڏيو، پوءِ جڏهن مٽي پير هيٺان چنبڙي نه پر آلي هجي (وَتَر)، تڏهن هر هلايو.
3. **ٻه کان ٽي هر ۽ سُهاڳو:** زمين کي ٻه يا ٽي ڀيرا هر ڏئي سُهاڳو هلايو ته جيئن ڍلا ڀڄن ۽ زمين جي آلاڻ اندر محفوظ رهي.
4. **زمين هموار ڪرڻ (Leveling):** ممڪن هجي ته ليزر ليولر سان زمين سڌي ڪرايو ته جيئن پاڻي سڄي ٻنيءَ ۾ هڪ جيترو پهچي.
5. **بنيادي ڀاڻ ۽ ڪيارا:** آخري تياريءَ ۾ ڊي اي پي وغيره ملائي، پنهنجي فصل مطابق ڪيارا يا کيلون ٺاهيو.

توهان ڪهڙي فصل لاءِ زمين تيار ڪري رهيا آهيو ۽ مٽي وارياسي آهي يا پڪي؟`;
  }

  if (mode === 'roman-ur') {
    return `## Zameen Ki Tayari (Land Preparation) Ka Mukammal Tarika

Sahi tayar shuda zameen beej ke barabar ugao aur mazboot jaron ki bunyad hoti hai:

1. **Safai aur Pehla Halka Pani (Rauni):** Pichli fasal ki jari-bootiyan saaf karein (parali/baqayaat ko aag lagane se bachein). Agar zameen khushk ho to rauni (pre-irrigation) kar ke **sahi watr** ka intezar karein.
2. **Sahi Watr ki Pehchan:** Mitti ko mutthi mein dabane se goli ban jaye lekin halka dabane par bikhar jaye aur haath par keechad na lage.
3. **2 se 3 Baar Hal aur Suhaga:** Mitti ko bhur-bhura karne ke liye 2–3 baar hal chalayein aur har baar **suhaga (planking)** dein taake dhele toot jayein aur nami zameen ke andar mehfooz rahe.
4. **Zameen Hamwar Karna (Leveling):** Mumkin ho to laser land leveling karwayein; is se pani khet mein barabar lagta hai aur paani ki bachat hoti hai.
5. **Basal Khad aur Kiyariyan:** Aakhri suhage se pehle DAP/Potash mitti mein milayein aur fasal ke hisab se munasib kiyariyan ya kheliyan (ridges) banayein.

**Aam Ghalti:** Bohat geeli zameen mein hal chalane se mitti sakht ho jati hai aur beej kam ugta hai.

Aap kis fasal ke liye zameen tayar kar rahe hain aur aap ki mitti kaisi hai (retli, chikni ya kalrathi)?`;
  }

  return `## How to Prepare Your Land Properly (Step-by-Step Seedbed Guide)

Good land preparation makes seeds sprout evenly, stops water from pooling, and helps young roots grow deep easily.

### Step 1: Clear Residues & Manage Weeds
- Remove heavy weeds or chop previous crop stubble into the soil cleanly. Avoid burning crop residues because fire destroys helpful organic matter and soil microbes.

### Step 2: Get Moisture Right (Pre-Irrigation / *Watr*)
- If the soil is bone dry and cloddy, give a light pre-sowing irrigation (*rauni*) and wait until the soil reaches workable moisture (**watr**): when you squeeze soil in your palm, it holds together loosely but does **not** feel sticky or muddy.
- **Mistake to avoid:** Never plow wet/muddy soil — heavy tractors pack it into hard clumps that block roots.

### Step 3: Plow & Break Clods (Tillage)
- Make **2 to 3 crisscross passes** with a cultivator (plus a deep chisel/subsoiler occasionally if soil has a hard compacted layer underneath).
- Work to about **6–8 inches** for most grain/vegetable crops so soil turns fine and crumbly (*bhur-bhura*).

### Step 4: Planking (*Suhaga*) & Leveling
- Run a plank (**suhaga**) behind plowing passes to crush clods, seal moisture inside the soil, and smooth the surface.
- If possible, use **laser land leveling** every couple of years — an unlevel field drowns low spots while high spots stay thirsty.

### Step 5: Mix Basal Inputs & Shape Plots/Beds
- On the final pass before sowing, mix basal fertilizers (such as DAP/well-rotted farmyard manure if used) into the soil and shape level irrigation basins (*kiyariyan*) or raised beds/ridges for row crops.

**Quick Check Question:** Which crop are you preparing this field for, and is your soil mostly sandy, clay/loam, or saline?`;
}

function buildDapUreaBeginnerGuide(mode: AdvisorLanguageMode): string {
  if (mode === 'ur-script') {
    return `## ڈی اے پی (DAP) اور یوریا (Urea) — بالکل سادہ اور آسان تعارف

اگر آپ کھادوں کے بارے میں کچھ نہیں جانتے تو سمجھ لیں کہ پودا بھی انسان کی طرح مختلف کاموں کے لیے الگ غذا مانگتا ہے:

### 1. ڈی اے پی (DAP) کیا ہے؟
- **اس میں کیا ہوتا ہے:** زیادہ مقدار میں **فاسفورس (46%)** اور تھوڑی **نائٹروجن (18%)**۔
- **پودے کو اس کی ضرورت کیوں ہے:** فاسفورس پودے کی **جڑیں مضبوط** بناتی ہے، ابتدائی بڑھوتری تیز کرتی ہے، اور آگے چل کر پھول/دانے بننے میں مدد دیتی ہے۔
- **کب اور کیسے ڈالیں:** چونکہ فاسفورس زمین میں زیادہ حرکت نہیں کرتی، اس لیے **ہمیشہ بوائی کے وقت زمین میں ملائیں** (جڑوں کے قریب رہے)۔

### 2. یوریا (Urea) کیا ہے؟
- **اس میں کیا ہوتا ہے:** خالص **نائٹروجن (46%)**۔
- **پودے کو اس کی ضرورت کیوں ہے:** نائٹروجن سے پتے **گہرے سبز** ہوتے ہیں، پودے کا قد اور نئی شاخیں (Tillers) بڑھتی ہیں — یعنی پودے کا ہرا بھرا ڈھانچہ بنتا ہے۔
- **کب اور کیسے ڈالیں:** نائٹروجن پانی کے ساتھ بہہ جاتی ہے یا دھوپ میں اڑ جاتی ہے، اس لیے **ساری یوریا ایک بار کبھی نہ ڈالیں**۔ بوائی کے بعد **پہلے اور دوسرے پانی کے ساتھ 2 سے 3 قسطوں** میں دیں۔

| خصوصیت | ڈی اے پی (DAP) | یوریا (Urea) |
|---|---|---|
| **اہم عنصر** | فاسفورس + تھوڑی نائٹروجن | خالص نائٹروجن |
| **بنیادی کام** | مضبوط جڑیں، پھول اور دانہ | ہرے پتے، شاخیں اور قد |
| **صحیح وقت** | بوائی کے وقت مٹی میں | فصل اگنے کے بعد پانی کے ساتھ (قسطوں میں) |

### عام غلطیاں جن سے بچیں
- **بوائی پر ساری یوریا ڈال دینا** یا کڑاکے کی دھوپ میں کھڑے پانی کے بغیر یوریا پھینکنا (کھاد ضائع ہو جاتی ہے)۔
- **بوائی کے مہینوں بعد ڈی اے پی اوپر سے ڈالنا** (وہ جڑوں تک آسانی سے نہیں پہنچتی)۔
- زیادہ یوریا ڈالنے سے پودا نازک اور لمبا ہو کر گر جاتا ہے اور کیڑے/بیماری جلدی حملہ کرتے ہیں۔
- اپنی فصل اور رقبے کے حساب سے صحیح بوری کی تعداد مٹی کے ٹیسٹ یا زرخیز کے **Fertilizer Calculator** سے دیکھیں۔

آپ کون سی فصل اگا رہے ہیں اور کتنے ایکڑ پر کھاد ڈالنی ہے؟`;
  }

  if (mode === 'sd') {
    return `## ڊي اي پي (DAP) ۽ يوريا (Urea) جو سادو تعارف

ٻوٽي کي مضبوط ٿيڻ لاءِ مختلف مرحلن تي مختلف خوراڪ گهرجي:

1. **ڊي اي پي (DAP — فاسفورس + ٿوري نائٽروجن):** هيءَ ڀاڻ ٻوٽي جون **پاڙون مضبوط** ڪري ٿي ۽ شروعاتي واڌ ۾ مدد ڏئي ٿي. ان کي هميشه **پوک وقت مٽيءَ ۾ ملائي** وجهو، ڇو ته فاسفورس مٽيءَ اندر پري ناهي وهندي.
2. **يوريا (Urea — نائٽروجن):** هيءَ ڀاڻ پنن کي سائو رکي ٿي ۽ شاخون وڌائي ٿي. يوريا پاڻيءَ سان وهجي يا اڏامي وڃي ٿي، تنهنڪري سڄي گڏ نه وجهو پر **ٻن يا ٽن حصن ۾ پاڻيءَ سان گڏ** ڏيو.
3. **احتياط:** پوک کان گهڻو پوءِ مٿان ڊي اي پي وجهڻ سان گهڻو فائدو ناهي ٿيندو، ۽ وڌيڪ يوريا وجهڻ سان فصل ڪمزور ٿي ڪِري سگهي ٿو.

توهان ڪهڙي فصل ۽ ڪيتري زمين لاءِ ڀاڻ جو پڇي رهيا آهيو؟`;
  }

  if (mode === 'roman-ur') {
    return `## DAP Aur Urea Kya Hain? (Beginner Ke Liye Bilkul Aasan Samajh)

Soch lein ke poday ki mazbooti ke liye usay alag waqt par alag khurak chahiye hoti hai:

### 1. DAP (Diammonium Phosphate)
- **Is mein kya hota hai:** Zyada **Phosphorus (46%)** aur thodi **Nitrogen (18%)**.
- **Poday ke liye kyun zaroori hai:** Ye poday ki **jarein (roots) mazboot** banati hai, shuruati growth achi karti hai, aur phool/dana banne mein madad deti hai.
- **Kab aur kaise dalain:** Phosphorus mitti mein ek jagah tikti hai, behti nahi — is liye DAP **hamesha bijai ke waqt zameen ki tayari mein** milayein.

### 2. Urea
- **Is mein kya hota hai:** Khalis **Nitrogen (46%)**.
- **Poday ke liye kyun zaroori hai:** Nitrogen se patay **sabz** hote hain, poday ka qad aur nayi **shaakhein (tillers)** badhti hain.
- **Kab aur kaise dalain:** Nitrogen jaldi pani ke sath beh ya hawa mein urr jati hai. Is liye saari Urea ek sath mat dalain — balke **fasal ugnay ke baad pehlay aur doosray pani ke sath 2 se 3 qiston (splits)** mein dein.

### Aam Ghaltiyan Jin Se Bachein
- **Urea aik sath dal dena** (paani mein beh kar zaya ho jati hai aur fasal zyada naram ho kar gir sakti hai).
- **DAP fasal badi hone par ooper se dalna** (wo jaron tak asaani se nahi pohanchti).
- Exact miqdaar zameen ke soil test aur Zarkhez ke **Fertilizer Calculator** se confirm karein.

Aap kis fasal ke liye puch rahe hain aur kitnay acre zameen hai?`;
  }

  return `## Explaining DAP and Urea to a Complete Beginner

Think of fertilizers like building a house: **DAP builds the underground foundation (roots)**, while **Urea grows the above-ground structure (green leaves and stems)**.

### 1. What is DAP? (**Diammonium Phosphate**)
- **What's inside:** High **Phosphorus (46%)** + a small starter amount of **Nitrogen (18%)**.
- **Why crops need it:** Phosphorus fuels strong **root development**, early seedling energy, and later flowering/grain formation.
- **When & how to apply:** Phosphorus barely moves through soil on its own, so **always mix DAP into the soil at land preparation or sowing** right where seeds and young roots can touch it.
- **Common mistake:** Scattering DAP on top of soil months after sowing wastes much of its benefit.

### 2. What is Urea?
- **What's inside:** Concentrated **Nitrogen (46%)**.
- **Why crops need it:** Nitrogen drives **lush green leaves, tillering (extra shoots), and stem growth** — the solar panels that power grain filling.
- **When & how to apply:** Nitrogen dissolves and washes away (leaching) or evaporates easily. Never dump all Urea at once! Instead, split it into **2–3 smaller doses** alongside scheduled irrigations (for example, around the 1st and 2nd wheat waterings).
- **Common mistakes:** Dumping all Urea at sowing (washes out before roots can use it), applying it on dry soil in blazing sun, or over-applying it (makes tall, weak stems that fall over and attract pests/fungal disease).

| Feature | **DAP** | **Urea** |
|---|---|---|
| **Main Nutrient** | Phosphorus (plus starter Nitrogen) | Pure Nitrogen |
| **Main Job** | Strong roots, energy & grain setting | Green leaves, tillers & growth |
| **Best Timing** | At **sowing** (mixed into soil) | **After emergence**, split across 2–3 irrigations |

*(Exact bags per acre depend on your crop, soil organic matter, and soil test results — you can check a tailored estimate in Zarkhez's **Fertilizer Calculator**.)*

**Quick Question:** Which crop are you planning to feed, and roughly how large is your field?`;
}

function buildWheatVsBarleyComparison(mode: AdvisorLanguageMode): string {
  if (mode === 'ur-script') {
    return `## گندم بمقابلہ جو (Wheat vs Barley) — کون سی فصل بہتر ہے؟

دونوں ربیع (سردیوں) کی فصلیں ہیں، لیکن صحیح انتخاب آپ کی زمین، پانی اور مقصد پر منحصر ہے:

| پہلو | گندم (Wheat) | جو (Barley) |
|---|---|---|
| **پانی کی ضرورت** | درمیانی سے زیادہ (عموماً 4–5 پانی) | کم پانی میں بھی چل جاتی ہے (2–3 پانی) |
| **مٹی اور کلراٹھا پن** | اچھی، زرخیز اور ہموار زمین پسند کرتی ہے | ریتلی، کمزور اور ہلکی کلراٹھی زمین بھی برداشت کر لیتی ہے |
| **موسمی سختی** | درمیانی سردی/خشکی برداشت کرتی ہے | خشکی اور سخت حالات میں زیادہ مضبوط |
| **منڈی اور فروخت** | پورے پاکستان میں سب سے زیادہ طلب اور آسان فروخت | منڈی محدود ہے؛ زیادہ تر چارے، مالٹ یا خاص خریداروں کے لیے |

### آپ کے لیے کون سی بہتر ہے؟
- **گندم لگائیں** اگر آپ کے پاس مناسب پانی (نہری یا ٹیوب ویل)، اچھی زمین ہے اور آپ آسان نقد فروخت یا گھر کے راشن کے لیے کاشت کرنا چاہتے ہیں۔
- **جو (Barley) لگائیں** اگر پانی کی سخت کمی ہو (بارانی یا کم نہری پانی)، زمین ریتلی یا ہلکی کلراٹھی ہو، یا آپ جانوروں کے سبز چارے/دانے کے لیے اگا رہے ہوں۔

آپ کس ضلع میں ہیں، پانی کتنا دستیاب ہے، اور آپ اسے بیچنے کے لیے اگا رہے ہیں یا چارے کے لیے؟`;
  }

  if (mode === 'sd') {
    return `## ڪڻڪ بمقابله جَو (Wheat vs Barley)

ٻئي سياري (ربيع) جون فصلون آهن، پر چونڊ توهان جي زمين ۽ پاڻيءَ تي دارومدار رکي ٿي:

| خوبي | ڪڻڪ (Wheat) | جَو (Barley) |
|---|---|---|
| **پاڻيءَ جي گهرج** | وڌيڪ (4 کان 5 پاڻي) | گهٽ پاڻيءَ ۾ به پچي وڃي ٿي |
| **زمين** | زرخيز ۽ چڱي مٽي گهرجي | وارياسي يا هلڪي ڪلراٺي زمين به سهي وڃي ٿي |
| **مارڪيٽ** | هر منڊيءَ ۾ آسانيءَ سان وڪرو ٿئي ٿي | منڊي محدود آهي، گهڻو چارو يا خاص خريدار |

- جيڪڏهن پاڻي ۽ زمين چڱي آهي ۽ آسان وڪرو چاهيو ٿا ته **ڪڻڪ** بهتر آهي.
- جيڪڏهن پاڻي گهٽ يا مٽي ڪمزور/ڪلراٺي آهي ته **جَو** محفوظ چونڊ آهي.

توهان جو ضلعو ڪهڙو آهي ۽ ٻنيءَ ۾ پاڻيءَ جو ڪهڙو بندوبست آهي؟`;
  }

  if (mode === 'roman-ur') {
    return `## Gandum (Wheat) Ya Jau (Barley) — Kaun Si Fasal Lagani Chahiye?

Dono sardi (Rabi) ki faslein hain, lekin sahi faisla aap ki mitti aur pani par depend karta hai:

| Cheez | Gandum (Wheat) | Jau (Barley) |
|---|---|---|
| **Pani ki zaroorat** | Zyada (aam taur par 4–5 pani) | Kam pani mein bhi ho jati hai (2–3 pani) |
| **Zameen / Mitti** | Achi, zarkhez mitti pasand karti hai | Retli, kamzor aur halki kalrathi mitti bhi bardasht kar leti hai |
| **Mandi & Bikri** | Har jagah bohat asani se bikti hai | Mandi mehdood hai (charay ya khas buyers ke liye) |

### Mashwara
- **Gandum chunein** agar aap ke paas acha pani aur upjau zameen hai, aur aap asani se mandi mein bechna ya ghar ke liye rakhna chahte hain.
- **Jau (Barley) chunein** agar pani bohat kam ho (barani ilaka), mitti retli/kalrathi ho, ya aap jaanwaron ke charay/feed ke liye uga rahe hon.

Aap kis shehar mein hain, pani kaisa hai, aur maqsad ghar/bikri hai ya chara?`;
  }

  return `## Wheat vs Barley — Which Should You Grow?

Both are winter (**Rabi**) grain crops, so the right choice comes down to your **water availability, soil quality, and buyer market**.

| Factor | **Wheat (Gandum)** | **Barley (Jau)** |
|---|---|---|
| **Water Requirement** | Moderate-to-high (usually **4–5 irrigations**) | Low-to-moderate (**2–3 irrigations**, drought tolerant) |
| **Soil & Salinity Tolerance** | Prefers fertile loam/clay soils; struggles in salty land | Handles **sandy, marginal, and mildly saline** soils well |
| **Growing Speed** | Standard winter maturity (~140–155 days) | Often matures slightly earlier with lower fertilizer demand |
| **Market & Demand** | **Universal demand** across every mandi and household | **Niche market** (mainly livestock feed, forage, malt/specialty buyers) |

### Recommendation
- **Grow Wheat** if you have reliable canal or tube-well irrigation, decent soil, and want easy, guaranteed market demand or household flour.
- **Grow Barley** if irrigation water is scarce (rain-fed / barani areas), your soil is sandy or mildly saline, or you primarily want resilient fodder/feed grain with lower input risk.

**To give a firm recommendation:** Which district are you in, is your soil fertile or sandy/saline, and do you have a buyer/fodder use in mind for barley?`;
}

function buildWhatIsZarkhezGuide(mode: AdvisorLanguageMode): string {
  if (mode === 'ur-script') {
    return `## زرخیز کیا ہے؟ — پاکستانی کسانوں کی مکمل ڈیجیٹل زرعی ایپلیکیشن

**زرخیز** ایک سمارٹ ویب اور موبائل زرعی ایپلیکیشن ہے جو خاص طور پر پاکستان کے کسانوں کے لیے بنائی گئی ہے، تاکہ بوائی سے کٹائی تک ہر مرحلے پر آپ کو آسان اور معتبر رہنمائی آپ کی اپنی زبان میں مل سکے۔

### زرخیز ایپ کے اہم فیچرز اور فوائد:
1. **آواز اور چیٹ پر زرعی مشیر:** آپ اردو، سندھی، رومن اردو یا انگریزی میں مائیک کے ذریعے بول کر یا لکھ کر فصل، کھاد، پانی، زمین کی تیاری اور کیڑوں کا حل پوچھ سکتے ہیں اور جواب صاف انسانی آواز میں سن سکتے ہیں۔
2. **فصل ڈاکٹر (لیْف اور پودا اسکین):** اپنے کھیت کے متاثرہ پتے، تنے، جڑ یا پھل کی تصویر کھینچ کر بیماری یا غذائی کمی کی بروقت پہچان اور محفوظ ابتدائی تدابیر حاصل کریں۔
3. **علاقائی موسم اور اسپرے الرٹس:** اپنے ضلع کا سات روزہ موسم، مٹی کا درجہ حرارت، ہیٹ ویو، تیز بارش، کہر (پالا) اور تیز ہوا میں اسپرے سے بچاؤ کی پیشگی وارننگ دیکھیں۔
4. **فصل کیلنڈر اور کھیت ٹریکر:** بوائی کی تاریخ کے حساب سے آبپاشی، کھاد اور دیکھ بھال کے مکمل شیڈول کے ساتھ اپنے کھیت کے مکمل شدہ کام نشان زد کریں۔
5. **کھاد کیلکولیٹر:** اپنی زمین کی زرخیزی اور ایکڑ کے مطابق ڈی اے پی، یوریا اور پوٹاش کی صحیح مقدار کلوگرام اور پچاس کلو بوریوں میں معلوم کریں۔
6. **منافع کا اندازہ اور فصل گائیڈ:** ہر فصل کے ربیع یا خریف سیزن، دورانیے اور متوقع خرچ بمقابلہ آمدنی کا حساب لگائیں۔
7. **فارم ڈائری (آف لائن سہولت کے ساتھ):** روزانہ کے کھیت نوٹس، بیج، کھاد، اسپرے، ڈیزل اور مزدوری کے اخراجات، آمدنی اور محفوظ کیے گئے پودوں کے اسکین ایک جگہ رکھیں۔
8. **سرکاری اسکیمیں اور کسان کارڈ پروفائل:** سرکاری سبسڈی، کسان کارڈ اور زرعی قرضوں کی تصدیق شدہ تفصیلات دیکھیں اور اپنا ضلع و فصل محفوظ کر کے ذاتی مشورہ حاصل کریں۔

آپ کس فصل یا ایپ کے کس حصے کے بارے میں ابھی جاننا چاہتے ہیں؟`;
  }

  if (mode === 'sd') {
    return `## زرخيز ڇا آهي؟ — هارين لاءِ مڪمل ڊجيٽل زرعي ايپليڪيشن

**زرخيز** هڪ سمارٽ ويب ۽ موبائل زرعي ايپليڪيشن آهي جيڪا خاص طور تي پاڪستان جي هارين لاءِ ٺاهي وئي آهي، ته جيئن پوک کان لاباري تائين هر مرحلي تي توهان کي پنهنجي زبان ۾ صاف ۽ سٺي رهنمائي ملي سگهي.

### زرخيز ايپ جا مکيه فيچر ۽ فائدا:
1. **آواز ۽ چيٽ زرعي صلاحڪار:** توهان سنڌي، اردو، رومن اردو يا انگريزي ۾ مائڪ تي ڳالهائي يا لکي پنهنجي فصل، پاڻي، ڀاڻ، زمين جي تياري ۽ جيتن بابت پڇي سگهو ٿا ۽ جواب پنهنجي زبان جي آواز ۾ ٻڌي سگهو ٿا.
2. **فصل ڊاڪٽر (پن ۽ ٻوٽي جو اسڪين):** متاثر پن، تڻي، پاڙ يا ڦل جي تصوير ڪڍي بيماريءَ يا طاقت جي گهٽتائيءَ جي شروعاتي سڃاڻپ ۽ محفوظ علاج ڄاڻو.
3. **موسم ۽ اسپري الرٽس:** پنهنجي ضلعي جو ستن ڏينهن جو موسم، مٽيءَ جي گرمي، تيز گرمي، برسات، پارو ۽ تيز هوا ۾ اسپري کان بچاءُ جون خبرداريون ڏسو.
4. **فصل ڪئلينڊر ۽ ٻنيءَ جو حساب:** پوک جي تاريخ موجب پاڻي ۽ ڀاڻ جا مقرر ڏينهن ۽ پنهنجي ٻنيءَ جا مڪمل ٿيل ڪم محفوظ ڪريو.
5. **ڀاڻ ڪيلڪيوليٽر:** زمين جي طاقت ۽ ايڪڙن موجب ڊي اي پي، يوريا ۽ پوٽاش جي پڪي مقدار ڪلوگرام ۽ پنجاهه ڪلو ٻورين ۾ ڄاڻو.
6. **منافعي جو اندازو ۽ فصل گائيڊ:** فصل جي موسم، مدي ۽ خرچ بمقابله آمدنيءَ جو حساب لڳايو.
7. **فارم ڊائري:** روزانو جا نوٽس، خرچ، وڪري جي آمدني ۽ محفوظ ڪيل اسڪين آف لائن به سنڀالي رکو.
8. **سرڪاري اسڪيمون ۽ ڪسان ڪارڊ پروفائيل:** سرڪاري سبسڊي، ڪسان ڪارڊ ۽ قرضن جي تصديق ٿيل ڄاڻ ڏسو ۽ پنهنجي ضلعي موجب سڌي رهنمائي وٺو.

اڄ توهان پنهنجي ڪهڙي فصل يا ايپ جي ڪهڙي سهولت بابت پڇڻ چاهيو ٿا؟`;
  }

  if (mode === 'roman-ur') {
    return `## Zarkhez Kya Hai? — Pakistani Kisanon Ki Mukammal Digital Zari Application

**Zarkhez** ek smart web aur mobile **agricultural application (app)** hai jo khaas taur par Pakistan ke kisanon ke liye banai gayi hai, taake bijai se katai tak har marhalay par aap ko aap ki apni zubaan mein aasan aur bharosemand mashwara mil sake.

### Zarkhez App Ke Ahem Features Aur Faiday:
1. **AI Awaz aur Chat Advisor:** Aap Urdu, Sindhi, Roman Urdu ya English mein mic par bol kar ya likh kar fasal, khad, pani, zameen ki tayari aur bimariyon ke sawal pooch sakte hain aur jawab saf insani awaz mein sun sakte hain.
2. **Fasal Doctor (Leaf aur Plant Scan):** Patay, tanay, jar ya phal ki tasveer lekar bimari ya khad ki kami ki pehchan aur mehfooz ibtidai ilaj hasil karein.
3. **Maqami Mausam aur Spray Alerts:** Apne shehar ka 7 din ka mausam, mitti ka temperature, shadeed garmi, tez barish, kohar aur tez hawa mein spray rokne ke alerts dekhein.
4. **Fasal Calendar aur Khet Tracker:** Bijai ki tareekh ke mutabiq pani aur khad ki exact tareekhein aur apne khet ke kaam track karein.
5. **Khad Calculator:** Zameen ki taaqat aur acre ke mutabiq DAP, Urea aur Potash ki sahi miqdaar kilo aur 50 kg boriyon mein nikalein.
6. **Munafay ka Andaza aur Fasal Guide:** Rabi ya Kharif season ke mutabiq kharch aur mutawaqqa aamdani ka hisab lagayein.
7. **Farm Diary (Offline Support ke Sath):** Khet ke rozana notes, beej, khad, spray, diesel/mazdoori ke kharch, aamdani aur saved leaf scans mehfooz rakhein.
8. **Sarkari Schemes aur Kisan Card Profile:** Sarkari Kissan Card, subsidies aur zari qarzoon ki tasdeeq-shuda maloomat dekhein aur apna zila aur fasal save kar ke exact mashwara lein.

Aap abhi Zarkhez app ka kaunsa feature istemal karna chahte hain ya kis fasal ke baray mein pooch rahe hain?`;
  }

  return `## What is Zarkhez? — A Complete Digital Farming Application

**Zarkhez** is an installable smart agriculture web and mobile **application (PWA)** built specifically for farmers in Pakistan to guide you in clear, practical steps from land preparation and sowing all the way to harvest.

### Key Features & Practical Uses of the Zarkhez App:
1. **AI Voice & Chat Farming Advisor:** Ask farming questions by speaking into the microphone or typing in **English, Urdu, Sindhi, or Roman Urdu**, and hear spoken replies aloud matching what appears on your screen.
2. **Crop Doctor (Leaf & Plant Scan):** Take or upload plant photos (supporting on-device leaf checks for Wheat, Rice, Tomato, and Maize plus multi-part Cloud AI diagnosis across leaves, stem, roots, whole plant, and fruit) to identify diseases, pests, and nutrient shortages early with safe action steps first.
3. **Local Weather & Spray Safety Alerts:** View your district's 7-day forecast, soil surface temperature and moisture, and early warnings for **Heatwaves (40°C+), Heavy Rain, Frost (2°C or below), and high-wind Do-Not-Spray alerts**.
4. **Crop Calendar & Cultivated Field Tracker:** Generate a dated sowing-to-harvest task schedule for your crops and tick off irrigation, fertilizer, and field activities directly on your Home dashboard.
5. **Verified Fertilizer Calculator:** Calculate exact per-acre and total **kilograms and 50 kg bags** (DAP, Urea, SOP/Potash) customized to your crop, acreage, and soil fertility level.
6. **Crop Guides & Profit Estimator:** Check Rabi/Kharif season fit, crop cycle length, upcoming tasks, and per-acre input cost versus estimated net profit.
7. **Offline-Ready Farm Diary:** Log daily field notes, input expenses (seed, fertilizer, spray, irrigation/diesel, labor), crop sales income in PKR, and saved scan history.
8. **Government Schemes Hub & Digital Kisan Card:** Browse verified provincial and national farmer subsidies, Kissan Card programs, and agricultural loans with official portal links, plus save your farm district and crops for tailored advice.

Which crop are you growing or which Zarkhez tool would you like to try first?`;
}

/**
 * Generates an intelligent, intent-adaptive offline/fallback agricultural advisor response
 * across simple Q&A, step-by-step guides, comparisons, diagnostics, and follow-up turns.
 */
export function generateAdaptiveFallbackReply(
  question: string,
  lang: 'en' | 'ur' = 'ur',
  context?: AdvisorFarmerProfile,
  history?: ChatHistoryTurn[],
  explicitMode?: AdvisorLanguageMode
): string {
  const trimmed = question.trim();
  const q = trimmed.toLowerCase();
  const modeInfo = detectUserLanguageMode(question, undefined, lang, history);
  const mode: AdvisorLanguageMode = explicitMode || modeInfo.mode;
  const resolvedContext = extractConversationHints(question, history, context);

  // 1. Simple arithmetic sanity / non-crop simple queries (SHORT WHEN SIMPLE)
  const mathMatch = trimmed.match(/^(?:what\s+is\s+)?(\d+)\s*\+\s*(\d+)\s*\??$/i);
  if (mathMatch) {
    const sum = Number(mathMatch[1]) + Number(mathMatch[2]);
    return mode === 'ur-script'
      ? `${sum}`
      : mode === 'sd'
      ? `${sum}`
      : `${sum}`;
  }

  // 2. Pure Greetings (Check strictly without overly broad substring false positives)
  if (
    /^(?:hi+|hello+|hey+|aoa|salam|salaam|assalam|السلام|سلام|ہیلو)\b/i.test(q) &&
    q.split(/\s+/).length <= 5 &&
    !/wheat|gandum|khad|pani|leaf|pat|grow|land|dap|urea|barley/.test(q)
  ) {
    if (mode === 'en') {
      return 'Assalam-o-Alaikum! I am Zarkhez, your farming assistant. How can I help you?';
    }
    if (mode === 'ur-script') {
      return 'السلام علیکم! میں زرخیز ہوں، آپ کی کھیتی باڑی کی مددگار۔ بتائیے، آج میں آپ کی کیا مدد کر سکتی ہوں؟';
    }
    if (mode === 'sd') {
      return 'السلام عليڪم! مان زرخيز آهيان، اوهان جي زراعت جي مددگار. ٻڌايو، اڄ مان اوهان جي ڪهڙي مدد ڪري سگهان ٿي؟';
    }
    return 'Assalam o Alaikum! Main Zarkhez hoon, aap ki kheti ka digital advisor. Aap apni fasal, pani, khad ya bimari ke baray mein kya poochna chahte hain?';
  }

  // 2b. "What is Zarkhez?" — Clear application overview, all features & practical uses
  if (
    /\b(?:what|who)\s+(?:is|are|does)\s+zarkh[aei]{1,2}z\b|\bexplain\s+zarkh[aei]{1,2}z\b|\b(?:about|introduce)\s+zarkh[aei]{1,2}z\b|\btell\s+(?:me|us)\s+about\s+zarkh[aei]{1,2}z\b|\bzarkh[aei]{1,2}z\s+(?:app|application|pwa|features?|uses?|tools?|benefits?|k[iy]a\s+h(?:ai|e|y)?|k[iy]a\s+kart[aei]|kis\s+kaam|ke\s+faid[ae]|ke\s+ba?r[ae]y?|c?hha\s+ah[ei]|cha\s+ah[ei])\b|\bwhat\s+(?:is|does)\s+this\s+app(?:lication)?\b|\b(?:app|application)\s+features?\b/i.test(
      q
    ) ||
    /زرخیز\s*(?:کیا|کس|کون|کیسی|ایپ|ایپلیکیشن|کے\s*(?:فائدے|فیچر|بارے))|زرخيز\s*(?:ڇا|ڪهڙي|ڪير|ايپ|ايپليڪيشن|جا\s*(?:فائدا|فيچر)|بابت)/.test(
      trimmed
    )
  ) {
    return buildWhatIsZarkhezGuide(mode);
  }

  // 3. Wheat vs Barley / Crop Comparison
  if (
    (/\bwheat\b|\bgandum\b|گندم|ڪڻڪ/.test(q) && /\bbarley\b|\bjau\b|جَو|جو/.test(q)) ||
    /\bcompare\b|\bshould i grow\b|\bwhich is better\b/.test(q)
  ) {
    return buildWheatVsBarleyComparison(mode);
  }

  // 4. Complete Wheat Cultivation Beginner Guide
  if (
    (/\bwheat\b|\bgandum\b|گندم|ڪڻڪ/.test(q) &&
      (/\bgrow\b|\bcultivat|\bcomplete\b|\bprocess\b|\bfull\b|\bstart\b|\bscratch\b|\bnothing about\b|\bbeginner\b|\buga|\bmukammal\b|\bمکمل\b|\bطریقہ\b|\bاگانے\b|\bپوکڻ\b/i.test(
        q
      ))) ||
    (/\bgrow wheat\b|\bwheat farming\b/i.test(q))
  ) {
    return buildWheatFullGuide(mode, resolvedContext.region);
  }

  // 5. Land / Seedbed Preparation Specific How-To
  if (
    /\bprepare\b.*\bland\b|\bland prep|\bseedbed\b|\bzameen\b.*\btayar|\btayari\b|\bplowing\b|\bplough|\bزمین.*تیار|\bزمين تيار/i.test(
      q
    )
  ) {
    return buildLandPreparationGuide(mode);
  }

  // 6. Beginner Fertilizer Education (DAP + Urea explanation)
  if (
    (/\bdap\b|\burea\b|ڈی اے پی|یوریا/.test(q) &&
      /\bexplain\b|\bknows nothing\b|\bbeginner\b|\bwhat is\b|\bdifference\b|\bsamjh|\bkya h|\bکیا ہے|\bتفصیل|\bآسان/.test(
        q
      )) ||
    (/\bexplain dap\b|\bexplain urea\b/i.test(q))
  ) {
    return buildDapUreaBeginnerGuide(mode);
  }

  // 7. Contextual Follow-Up or Simple Irrigation Timing Question
  if (
    q.includes('پانی') ||
    q.includes('آبپاشی') ||
    q.includes('پاڻي') ||
    q.includes('water') ||
    q.includes('irrigat') ||
    q.includes('pani') ||
    q.includes('pehle pani') ||
    q.includes('pehla pani') ||
    q.includes('1st irrigation')
  ) {
    const contextPrefixEn = resolvedContext.acres
      ? `For your **${resolvedContext.acres}** of **${resolvedContext.crop}** in **${resolvedContext.region}**:\n`
      : '';
    if (resolvedContext.crop === 'barley') {
      if (mode === 'ur-script') {
        return `${resolvedContext.region} میں جو (Barley) کو عام طور پر 2 سے 3 پانی کافی ہوتے ہیں: پہلا پانی بوائی کے 25–30 دن بعد اور دوسرا سٹہ نکلتے وقت دیں۔ ریتلی مٹی ہو تو ہلکا پانی تھوڑا جلدی لگ سکتا ہے۔`;
      }
      if (mode === 'en') {
        return `${contextPrefixEn}Barley needs fewer irrigations than wheat — typically **2 to 3 waterings**:\n1. **First irrigation:** 25–30 days after sowing (tillering).\n2. **Second irrigation:** At booting/heading (~60–65 days).\n3. **Third (optional in sandy soil):** Grain filling — skip if winds exceed 5 m/s.`;
      }
    }

    // Preserve concise <500 chars format for direct simple irrigation questions
    if (mode === 'ur-script') {
      return `${resolvedContext.region} میں گندم کو پہلا پانی بوائی کے 20 سے 25 دن بعد لگائیں جب تاج کی جڑیں (Crown Roots) بن رہی ہوں، اور ساتھ یوریا کی پہلی قسط دیں۔ دوسرا پانی تقریباً 55 دن اور تیسرا سٹہ نکلتے وقت دیں؛ تیز ہوا (5 m/s سے زیادہ) میں پانی نہ لگائیں۔`;
    }
    if (mode === 'sd') {
      return 'ڪڻڪ کي پهريون پاڻي پوک کان 20 کان 25 ڏينهن پوءِ ڏيو جڏهن پاڙون مضبوط ٿين، گڏوگڏ يوريا ڀاڻ جو پهريون حصو ڏيو. ٻيو پاڻي اٽڪل 55 ڏينهن ۽ ٽيون سنگ نڪرڻ وقت ڏيو؛ تيز هوا ۾ پاڻي نه لڳايو.';
    }
    if (mode === 'roman-ur') {
      return `Gandum (wheat) ko pehla pani bijai ke 20 se 25 din baad lagana chahiye jab us ki jarein (crown roots) banna shuru hoti hain. Sath hi 1 bori Urea ki pehli split dein.\n1. Doosra pani booting stage (takreeban 55 din) par aur teesra pani sitta nikalte waqt dein.\n2. Ahem tip: Agar tez hawa (5 m/s se zyada) chal rahi ho ya barish ka imkan ho to pani hargiz na lagayein taake fasal gir (lodging) na jaye.`;
    }
    return `${contextPrefixEn}1. Apply the first wheat irrigation **20 to 25 days** after sowing at the crown-root initiation (CRI) stage, accompanied by your first split of Urea.\n2. Apply the second irrigation at booting (around day 55) and the third at heading.\n3. Pro tip: Never irrigate when winds exceed 5 m/s or rain is imminent to avoid crop lodging.`;
  }

  // 8. Yellowing Leaves / Foliage Symptoms Differential Troubleshooting
  if (
    q.includes('yellow') ||
    q.includes('peel') ||
    q.includes('پیل') ||
    q.includes('پيل') ||
    q.includes('پت') ||
    q.includes('مڑ') ||
    q.includes('بیمار') ||
    q.includes('کنگی') ||
    q.includes('جھلساؤ') ||
    q.includes('تیل') ||
    q.includes('leaf') ||
    q.includes('curl') ||
    q.includes('blight') ||
    q.includes('rust') ||
    q.includes('spot') ||
    q.includes('sukr') ||
    q.includes('keera') ||
    q.includes('sundi') ||
    q.includes('makhi')
  ) {
    if (q.includes('yellow') || q.includes('peel') || q.includes('پیل') || q.includes('پيل')) {
      return buildYellowLeavesGuide(mode);
    }
    if (mode === 'ur-script') {
      return `پتوں کا مڑنا، دھبے بننا یا کمزور ہونا پھپھوندی (Fungal blight/rust) یا رس چوسنے والے کیڑوں (سفید مکھی/تیلہ) کی علامت ہو سکتا ہے۔\n1. دن کی روشنی میں **Scan Leaf** سے متاثرہ پتے کی صاف تصویر لیں۔\n2. پتوں کے نیچے کیڑے چیک کریں اور کھیت کے کناروں سے جڑی بوٹیاں صاف رکھیں۔\n3. کسی بھی سپرے سے پہلے پروڈکٹ لیبل پڑھیں اور مقامی زرعی افسر سے مشورہ کریں۔`;
    }
    if (mode === 'sd') {
      return 'پنن تي داغ يا مڙڻ ڦڦوندي يا رس چوسيندڙ جيتن جي نشاني ٿي سگهي ٿو. ڏينهن جي روشنيءَ ۾ Scan Leaf سان فوٽو اسڪين ڪريو، گهڻو خراب پن پري ڪريو، ۽ ڪنهن به دوا کان اڳ زرعي آفيسر کان صلاح وٺو.';
    }
    if (mode === 'roman-ur') {
      return `Paton ka peela hona, curl hona ya dhabbe banna aam taur par phaphondi (fungal blight) ya ras choosne wale keeron (safaid makhi/teli) ki alamat ho sakti hai.\n1. Behtar tashkhees ke liye app ke "Scan Leaf" camera se din ki achi roshni mein mutasira patay ki saaf photo lein.\n2. Jo patay ya poday zyada kharab hon unhein khet se nikaal kar mitti mein daba dein aur waton se jari-bootiyan saaf rakhein.\n3. Koi bhi spray karne se pehle product label aur apne zila ke agriculture extension officer se zaroor consult karein.`;
    }
    return `Leaf curling or lesions usually point to fungal blights or sucking pest vectors (whitefly/aphids).\n1. Text descriptions cannot replace optical inspection; please use the **Scan Leaf** camera in Zarkhez to capture a clear daylight photo.\n2. Rogue out severely infested leaves and keep field ridges weed-free.\n3. Always verify product recommendations with your local agricultural extension officer.`;
  }

  // 9. Spray Timing & Weather Safety
  if (
    q.includes('سپرے') ||
    q.includes('موسم') ||
    q.includes('بارش') ||
    q.includes('اسپري') ||
    q.includes('spray') ||
    q.includes('weather') ||
    q.includes('rain') ||
    q.includes('hawa') ||
    q.includes('wind')
  ) {
    const weatherNote = context?.weatherSummary
      ? ` (${resolvedContext.region}: ${context.weatherSummary})`
      : '';
    if (mode === 'roman-ur') {
      return `Spray karne se pehle mausam ka jaiza lena bohat zaroori hai.${weatherNote}\n1. Hamesha us waqt spray karein jab hawa ki raftar 5 m/s se kam ho aur aglay 24 ghanton mein barish ka imkan 40% se kam ho.\n2. Subah shabnam khushk hone ke baad ya asar ke waqt thanday mausam mein spray karein; tez dhoop aur dophar mein spray hargiz na karein.\n3. Hamesha safety mask aur gloves pehnein aur nozzle ko paton ke 1.5 foot ooper rakh kar spray karein.`;
    }
    if (mode === 'ur-script') {
      return `سپرے سے پہلے موسم دیکھنا بہت ضروری ہے۔${weatherNote}\n1. سپرے تب کریں جب ہوا 5 m/s سے کم ہو اور اگلے 24 گھنٹوں میں بارش کا امکان کم ہو۔\n2. صبح شبنم خشک ہونے کے بعد یا شام ٹھنڈے وقت سپرے کریں، تیز دھوپ میں نہیں۔\n3. حفاظتی ماسک اور دستانے پہنیں اور لیبل کی ہدایت کے مطابق عمل کریں۔`;
    }
    if (mode === 'sd') {
      return `اسپري کان اڳ موسم ڏسڻ تمام ضروري آهي.${weatherNote}\n1. اسپري تڏهن ڪريو جڏهن هوا پنج ميٽر في سيڪنڊ کان گهٽ هجي ۽ ايندڙ چوويهن ڪلاڪن ۾ برسات جو امڪان نه هجي.\n2. صبح جو ماڪ سڪڻ کان پوءِ يا شام جو ٿڌي وقت اسپري ڪريو، تيز اس ۾ هرگز نه ڪريو.\n3. حفاظتي ماسڪ ۽ دستانا پائي بوتل جي هدايت موجب عمل ڪريو.`;
    }
    return `Reviewing weather parameters before spraying protects both your investment and crop.${weatherNote}\n1. Only spray when wind speed is below 5 m/s and 24-hour rain probability is under 40%.\n2. Spray in early morning after dew evaporates or in late afternoon — never in peak midday heat.\n3. Wear protective gloves and a mask, keeping nozzles calibrated to target foliage.`;
  }

  // 10. General Fertilizers (Balanced DAP + Split Urea)
  if (
    q.includes('کھاد') ||
    q.includes('یوریا') ||
    q.includes('ڈی اے پی') ||
    q.includes('ڀاڻ') ||
    q.includes('fertilizer') ||
    q.includes('urea') ||
    q.includes('dap') ||
    q.includes('khad') ||
    q.includes('potash') ||
    q.includes('zinc') ||
    q.includes('boron')
  ) {
    if (mode === 'ur-script') {
      return `متوازن کھاد اچھی پیداوار کی ضمانت ہے:\n1. **ڈی اے پی (DAP)** اور **پوٹاش (SOP)** بوائی کے وقت زمین میں ملائیں تاکہ جڑیں مضبوط بنیں۔\n2. **یوریا (Urea)** ایک ساتھ نہ ڈالیں بلکہ آبپاشی کے ساتھ 2 سے 3 قسطوں میں دیں۔\n3. اپنی زمین اور ایکڑ کے مطابق مقدار دیکھنے کے لیے **Fertilizer Calculator** استعمال کریں۔`;
    }
    if (mode === 'sd') {
      return `متوازن ڀاڻ سٺي پيداوار جي ضمانت آهي:\n1. **ڊي اي پي (DAP)** ۽ **پوٽاش (SOP)** پوک وقت زمين ۾ ملايو ته جيئن پاڙون مضبوط ٿين.\n2. **يوريا (Urea)** هڪ ئي وقت نه وجهو، بلڪه پاڻيءَ سان گڏ ٻن کان ٽن قسطن ۾ ڏيو.\n3. پنهنجي زمين ۽ ايڪڙ موجب صحيح مقدار ڏسڻ لاءِ زرخيز ايپ جو **Fertilizer Calculator** استعمال ڪريو.`;
    }
    if (mode === 'roman-ur') {
      return `Mutawazan khad (balanced nutrition) hi bharpoor paidawar ki zamanat hai.\n1. DAP aur Potash (SOP) hamesha zameen ki tayari ya bijai ke waqt dein taake poday ki jarein mazboot banein.\n2. Urea ko hamesha 2 se 3 hisson mein taqseem kar ke aabpashi ke sath dein, kabhi bhi saari Urea ek sath na dalain.\n3. Apni zameen aur acre ke hisab se exact miqdaar janne ke liye Zarkhez app ka "Fertilizer Calculator" use karein.`;
    }
    return `Balanced fertilization delivers resilient rooting and optimal grain weight.\n1. Apply basal DAP and Potash (SOP) at seedbed preparation or drilling.\n2. Split Urea into 2 to 3 applications with scheduled irrigations rather than dumping it all at once.\n3. Open the "Fertilizer Calculator" in Zarkhez to get verified per-acre rates tailored to your soil fertility.`;
  }

  // 11. Mandi Prices / Unverified Claims (Anti-Hallucination)
  if (
    q.includes('mandi') ||
    q.includes('rate') ||
    q.includes('price') ||
    q.includes('qeemat') ||
    q.includes('bhao') ||
    q.includes('قیمت') ||
    q.includes('منڈی') ||
    q.includes('api key') ||
    q.includes('secret')
  ) {
    if (mode === 'ur-script') {
      return 'منڈی کے ریٹ روزانہ ہر شہر میں بدلتے رہتے ہیں۔ تصدیق شدہ ریٹ کے لیے مقامی غلہ منڈی کمیٹی یا سرکاری زرعی پورٹل سے چیک کریں — میں غلط یا فرضی قیمت نہیں بتاتا۔';
    }
    if (mode === 'sd') {
      return 'منڊي جا اگهه روزانو هر شهر ۾ بدلجندا رهندا آهن. پڪي قيمت لاءِ مقامي غله منڊي ڪميٽي يا سرڪاري زرعي پورٽل تان پڇو، ته جيئن ڪنهن غلط اندازي کان نقصان نه ٿئي.';
    }
    if (mode === 'roman-ur') {
      return `Mandi ke daily rates har shehar mein ghanta-ba-ghanta tabdeel hotay rehtay hain aur verified real-time rate ke liye local ghalla mandi committee ya official portal se check karna zaroori hai. Main ghalat ya farzi qeemat bata kar aap ko nuqsaan nahi pohanchana chahta.\nFasal ki kheti, bimari ya khad ke baare mein koi bhi sawal poochiye!`;
    }
    return `Grain market (mandi) commodity prices fluctuate daily across regional markets. For accurate, verified prices, please check your local Market Committee or official Punjab/Sindh Agri portals. I strictly avoid giving unverified price estimates to protect you from financial discrepancy.`;
  }

  // 12. Context Acknowledgment (e.g. user says "I am in Bahawalpur and have 2 acres.")
  if (
    /\b(acres?|bahawalpur|multan|faisalabad|lahore|sahiwal|sukkur|hyderabad|larkana)\b/i.test(q)
  ) {
    if (mode === 'en') {
      return `Got it — I've noted **${resolvedContext.acres || 'your field'}** in **${resolvedContext.region}** (for **${resolvedContext.crop}**).\n\nWhat would you like to plan next: soil preparation, sowing timing, fertilizer schedule, or irrigation dates?`;
    }
    if (mode === 'sd') {
      return `ٺيڪ آهي، مون **${resolvedContext.region}** ۾ اوهان جي زمين (${resolvedContext.acres || 'ٻني'}) ۽ فصل (**${resolvedContext.crop}**) نوٽ ڪري ڇڏيو آهي. هاڻي اوهان زمين جي تياري، پوک جي وقت، ڀاڻ يا پاڻي بابت ڇا ڄاڻڻ چاهيو ٿا؟`;
    }
    if (mode === 'ur-script') {
      return `بہت خوب — میں نے **${resolvedContext.region}** میں آپ کا رقبہ (${resolvedContext.acres || 'کھیت'}) ذہن میں رکھ لیا ہے۔ اب آپ **${resolvedContext.crop}** کی بوائی، کھاد یا پانی کے بارے میں کیا جاننا چاہتے ہیں؟`;
    }
  }

  // 13. General Supportive Fallback
  if (mode === 'ur-script') {
    return `میں زرخیز ہوں، آپ کی کھیتی کا ڈیجیٹل زرعی مشیر۔\n1. فصل کے پتے پر بیماری یا کیڑا نظر آئے تو **Scan Leaf** سے صاف تصویر لیں۔\n2. کھاد اور پانی کے پلان کے لیے **Fertilizer Calculator** اور **Crop Calendar** دیکھیں۔\n3. بتائیے آج آپ کس فصل (گندم، دھان، کپاس، گنا، مکئی یا سبزی) کے بارے میں رہنمائی چاہتے ہیں؟`;
  }
  if (mode === 'sd') {
    return 'السلام عليڪم هاري ڀاءُ! مان زرخيز آهيان، اوهان پنهنجي فصل، پاڻي، ڀاڻ يا بيماري بابت سڌو سنڌيءَ ۾ پڇي سگهو ٿا. اڄ مان اوهان جي ڪهڙي مدد ڪري سگهان ٿي؟';
  }
  if (mode === 'roman-ur') {
    return `Main Zarkhez hoon, aap ki kheti ka mukhlis digital advisor.\n1. Fasal ke patay par bimari ya keera ho to "Scan Leaf" button se photo lein.\n2. Pani aur khad ke schedule ke liye "Crop Calendar" aur "Fertilizer Calculator" open karein.\n3. Aap kis fasal (gandum, dhan, kapas, kamad, makai ya tamatar) ke baare mein poochna chahte hain? Voice ya text mein batayein!`;
  }
  return `I am Zarkhez, your personal agricultural advisor.\n1. If you notice signs of disease on your crops, use "Scan Leaf" to inspect a clear daylight photograph.\n2. Use the "Crop Calendar" and "Fertilizer Calculator" to plan your inputs.\n3. Which crop can I assist you with today (wheat, rice, cotton, sugarcane, maize, or tomato)?`;
}

/**
 * Generates dual offline output:
 * - `screenText`: Rich adaptive guide in the user's actual language/script
 * - `spokenText`: Exact spoken mirror of `screenText` without Markdown syntax or mismatching filler
 */
export function generateAdaptiveSpokenDualFallback(
  question: string,
  voiceLang: VoiceLang,
  context?: AdvisorFarmerProfile,
  history?: ChatHistoryTurn[],
  explicitVoiceLang = false
): { screenText: string; spokenText: string; language: VoiceLang } {
  const { mode: screenMode, voiceLang: effectiveVoiceLang } =
    resolveAdvisorLanguageSelection({
      text: question,
      voiceLang,
      history,
      explicitVoiceLang,
    });

  const screenText = generateAdaptiveFallbackReply(
    question,
    effectiveVoiceLang === 'en' ? 'en' : 'ur',
    context,
    history,
    screenMode
  );

  // For English, Sindhi, and Urdu script, spokenText strictly mirrors screenText 1:1 with Markdown flattened
  if (screenMode !== 'roman-ur') {
    const exactSpoken = convertMarkdownReplyToSpokenText(screenText, effectiveVoiceLang);
    return {
      screenText,
      spokenText: exactSpoken || screenText,
      language: effectiveVoiceLang,
    };
  }

  // Only when screenText is Roman Urdu (ur mode with Latin text) do we emit Perso-Arabic Urdu narration
  const q = question.toLowerCase();
  let spokenText = '';

  if (/^(?:what\s+is\s+)?(\d+)\s*\+\s*(\d+)\s*\??$/i.test(question.trim())) {
    const m = question.trim().match(/^(?:what\s+is\s+)?(\d+)\s*\+\s*(\d+)\s*\??$/i)!;
    const ans = Number(m[1]) + Number(m[2]);
    return { screenText, spokenText: `اس کا جواب ${ans} ہے۔`, language: 'ur' };
  }

  if (/پانی|آبپاشی|water|pani|irrigat/.test(q)) {
    spokenText =
      'گندم کو پہلا پانی بجائی کے بیس سے پچیس دن بعد لگائیں، کیونکہ اسی وقت پودے کی جڑیں مضبوط ہو رہی ہوتی ہیں۔ ساتھ ہی یوریا کھاد کی پہلی قسط دے دیں، اور اگر تیز ہوا چل رہی ہو تو پانی روک لیں۔ کیا آپ کی زمین ریتلی ہے یا چکنی؟';
  } else if (/سپرے|موسم|بارش|spray|weather|rain|hawa|wind/.test(q)) {
    spokenText =
      'سپرے تب ہی کریں جب ہوا ہلکی ہو اور بارش کا کوئی امکان نہ ہو۔ صبح شبنم خشک ہونے کے بعد، یا شام ڈھلتے وقت سپرے سب سے بہتر رہتا ہے تاکہ دوا پتوں پر اچھی طرح ٹک سکے۔ آپ کس بیماری یا کیڑے کے لیے سپرے کرنا چاہتے ہیں؟';
  } else if (/کھاد|یوریا|ڈی اے پی|fertilizer|urea|dap|khad|potash/.test(q)) {
    spokenText =
      'بوائی کے وقت ڈی اے پی اور پوٹاش زمین میں ملائیں، اور یوریا کھاد ایک ساتھ ڈالنے کے بجائے دو یا تین حصوں میں پانی کے ساتھ دیں تاکہ خوراک ضائع نہ ہو اور پیداوار بہتر آئے۔ آپ یہ کھاد کس فصل کے لیے پوچھ رہے ہیں؟';
  } else if (/پت|بیمار|مڑ|کنگی|دھب|تیل|پیل|leaf|curl|blast|rust|peela|sukr|keera|yellow/.test(q)) {
    spokenText =
      'صحیح پہچان کے لیے پہلے مٹی کی نمی اور پتوں کی اوپر نیچے جانچ کریں اور دن کی روشنی میں واضح تصویر لے کر اسکین کر لیں۔ کسی بھی زہر کے سپرے سے پہلے قریبی زرعی ماہر سے ضرور پوچھ لیں۔';
  } else {
    spokenText = transliterateCommonRomanUrduToUrdu(
      convertMarkdownReplyToSpokenText(screenText, 'ur')
    );
  }

  return { screenText, spokenText, language: 'ur' };
}
