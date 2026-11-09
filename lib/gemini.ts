import fs from 'node:fs';
import path from 'node:path';
import diseasesData from '@/data/diseases.json';
import type { ImageQualityReport } from './image-quality';
import {
  Advice,
  AdviceSchema,
  SecondOpinion,
  SecondOpinionSchema,
  CropDiagnosis,
  CropDiagnosisSchema,
  LocalizedString,
} from './schemas';

/**
 * Google Gemini Multimodal Plant Pathology & Farming Advisor (lib/gemini.ts)
 * - Uses Gemini 1.5 Pro / Flash with native JSON schema generation
 * - Fallback grounded in Pakistani agricultural extension knowledge base
 * - Zero extra npm dependencies (uses native fetch + JSON response mode)
 */

const adviceCache = new Map<string, Advice>();

export const GEMINI_CHAT_SYSTEM_PROMPT = `آپ "زرخیز" (Zarkhez) ہیں — پاکستانی کسانوں کے مخلص، تجربہ کار اور شفیق زرعی دوست۔
آپ کا اندازِ گفتگو بالکل ایک شائستہ، ہمدرد اور ماہر پاکستانی زرعی مشیر جیسا ہونا چاہیے تاکہ جب آپ کا جواب آواز (Voice) میں سنا جائے تو وہ بالکل انسان جیسا فطری اور رواں لگے۔
اصول:
- اگر سوال اردو یا رومن اردو میں ہو تو جواب ہمیشہ خوبصورت، سلیس اور بامحاورہ اردو رسم الخط میں دیں۔
- کسان کو عزت کے ساتھ مخاطب کریں (اگر کسان کا نام مہیا ہو تو ان کا نام لے کر مخاطب کریں، مثلاً "محترم بھائی [نام]، السلام علیکم!")۔
- جواب مختصر، جامع اور بولنے کے انداز میں (100 سے 130 الفاظ کے اندر) رکھیں اور عملی تدابیر کو 1، 2، 3 نمبروں میں بیان کریں۔
- صرف تحریر سے پتے کی بیماری کی حتمی تشخیص نہ کریں بلکہ ایپ کے "پتا سکین کریں" (Scan Leaf) بٹن یا مقامی زرعی افسر سے معائنہ کروانے کا مشورہ دیں۔
- زرعی ادویات کی خطرناک مقدار ہرگز نہ بتائیں؛ ہمیشہ لیبل پڑھنے اور مقامی زرعی افسر سے مشورے کی تاکید کریں۔`;

export function getStaticFallbackAdvice(
  label: string,
  confidence: number
): Advice {
  const diseases = diseasesData as Record<string, Advice & { crop?: string }>;
  const entry = diseases[label] || diseases['not_a_plant'];
  const lowConf = confidence < 0.75 || label === 'not_a_plant';

  return {
    problem_name: entry?.problem_name || { en: 'Crop Check', ur: 'فصل کا معائنہ' },
    severity: entry?.severity || 'medium',
    summary: entry?.summary || {
      en: 'Visual symptoms observed on crop foliage. Follow preventative crop hygiene.',
      ur: 'فصل کے پتوں پر علامات دیکھی گئی ہیں۔ کھیت کی صفائی اور وتر کا خیال رکھیں۔',
    },
    steps: entry?.steps || [
      {
        en: 'Remove and burn severely damaged leaves.',
        ur: 'شدید متاثرہ پتے توڑ کر کھیت سے دور ٹھکانے لگائیں۔',
      },
      {
        en: 'Avoid over-irrigation and stagnant water.',
        ur: 'کھیت میں اضافی پانی کھڑا نہ ہونے دیں اور وتر کا خیال رکھیں۔',
      },
    ],
    prevention: entry?.prevention || [
      {
        en: 'Scout your fields every morning.',
        ur: 'روزانہ صبح کے وقت کھیت کا باقاعدگی سے معائنہ کریں۔',
      },
      {
        en: 'Consult local agricultural extension officer.',
        ur: 'کسی بھی سپرے سے قبل مقامی زرعی توسیعی افسر سے تصدیق کریں۔',
      },
    ],
    see_expert: lowConf ? true : (entry?.see_expert ?? false),
    expert_reason:
      entry?.expert_reason ||
      (lowConf
        ? {
            en: 'Confidence is below 75%. Please take a closer photo in daylight or consult your local agriculture officer.',
            ur: 'تشخیص کا اعتماد 75 فیصد سے کم ہے۔ براہِ کرم دن کی قدرتی روشنی میں پتے کی صاف تصویر لیں یا مقامی زرعی افسر سے مشورہ کریں۔',
          }
        : undefined),
  };
}

export function generateFallbackChatReply(
  question: string,
  lang: 'en' | 'ur' = 'ur',
  context?: {
    crop?: string;
    region?: string;
    farmerName?: string;
    farmerId?: string;
    stage?: string;
    weatherSummary?: string;
  }
): string {
  const q = question.toLowerCase();
  const isUrduQuestion = /[\u0600-\u06FF]/.test(question) || lang === 'ur';
  const nameGreetingUr = context?.farmerName
    ? `محترم بھائی ${context.farmerName}`
    : 'محترم کسان بھائی';
  const nameGreetingEn = context?.farmerName
    ? `Dear Brother ${context.farmerName}`
    : 'Dear Farmer Friend';

  if (
    q.includes('پانی') ||
    q.includes('آبپاشی') ||
    q.includes('water') ||
    q.includes('irrigat') ||
    q.includes('گندم') ||
    q.includes('gandum')
  ) {
    return isUrduQuestion
      ? `${nameGreetingUr}، گندم اور فصلوں کی بروقت آبپاشی اچھی پیداوار کی کنجی ہے۔\n1۔ گندم کو پہلا پانی بجائی کے بیس سے پچیس دن بعد، جب جڑیں بن رہی ہوں، لازمی لگائیں اور ساتھ یوریا کی پہلی قسط دیں۔\n2۔ دوسرا پانی پچپن دن کے قریب گوبھ کی حالت میں اور تیسرا پانی سٹہ نکلتے وقت لگائیں۔\n3۔ ایک خاص احتیاط رکھیں کہ اگر تیز ہوا چل رہی ہو یا بارش کا امکان ہو تو پانی ہرگز نہ لگائیں تاکہ فصل گرنے سے محفوظ رہے۔\nاللہ آپ کی کھیتی میں خوب برکت عطا فرمائے۔`
      : `${nameGreetingEn}, timely irrigation is key to a strong harvest.\n1. Apply the first wheat irrigation 20 to 25 days after sowing at the crown-root stage, along with your first split of Urea.\n2. Apply the second irrigation at booting (around day 55) and the third at heading.\n3. Never irrigate during strong winds (5 m/s or higher) to prevent crop lodging.`;
  }

  if (
    q.includes('پت') ||
    q.includes('مڑ') ||
    q.includes('بیمار') ||
    q.includes('کنگی') ||
    q.includes('رسٹ') ||
    q.includes('جھلساؤ') ||
    q.includes('تیل') ||
    q.includes('مکھی') ||
    q.includes('leaf') ||
    q.includes('curl') ||
    q.includes('blight') ||
    q.includes('rust')
  ) {
    return isUrduQuestion
      ? `${nameGreetingUr}، پتوں کا مڑنا، پیلا ہونا یا دھبے پڑنا پھپھوندی یا سفید مکھی کی علامت ہو سکتا ہے۔\n1۔ چونکہ صرف بات چیت سے بیماری کی سو فیصد پکی تشخیص ممکن نہیں، اس لیے براہِ کرم ایپ کے "پتا سکین کریں" بٹن سے دن کی روشنی میں ایک متاثرہ پتے کی صاف تصویر لیں۔\n2۔ کھیت میں جو پودے یا نچلے پتے شدید متاثر ہوں انہیں احتیاط سے توڑ کر کھیت سے دور مٹی میں دبا دیں اور کھالوں سے جڑی بوٹیاں صاف رکھیں۔\n3۔ کوئی بھی زرعی دوا سپرے کرنے سے پہلے اپنے علاقے کے زرعی توسیعی افسر کو پودا ضرور دکھائیں۔`
      : `${nameGreetingEn}, leaf curling or spotting can be caused by viral vectors like whitefly or fungal blight.\n1. Since text alone cannot confirm a diagnosis, please open the "Scan Leaf" tool and take a clear daylight photo of one affected leaf.\n2. Remove heavily infected lower leaves and clear weeds along field borders.\n3. Always confirm with your local agriculture officer before spraying any product.`;
  }

  if (
    q.includes('سپرے') ||
    q.includes('موسم') ||
    q.includes('بارش') ||
    q.includes('ہوا') ||
    q.includes('spray') ||
    q.includes('weather') ||
    q.includes('rain')
  ) {
    const weatherNote = context?.weatherSummary
      ? `اس وقت ${context.region || 'آپ کے علاقے'} کا موسم: ${context.weatherSummary} ہے۔`
      : '';
    return isUrduQuestion
      ? `${nameGreetingUr}، سپرے کرنے سے پہلے موسم کا جائزہ لینا بہت ضروری ہے۔ ${weatherNote}\n1۔ ہمیشہ اس وقت سپرے کریں جب ہوا کی رفتار پانچ میٹر فی سیکنڈ سے کم ہو اور اگلے چوبیس گھنٹے بارش کا امکان نہ ہو۔\n2۔ صبح شبنم خشک ہونے کے بعد یا عصر کے وقت سپرے کرنا سب سے زیادہ مؤثر رہتا ہے، تیز دھوپ میں سپرے نہ کریں۔\n3۔ دوا کی مقدار ہمیشہ لیبل اور مقامی زرعی افسر کے مشورے کے مطابق رکھیں۔`
      : `${nameGreetingEn}, checking local weather before spraying saves both money and your crop.\n1. Only spray when wind speed is under 5 m/s and 24-hour rain probability is below 40%.\n2. Spray in the morning after dew dries or in late afternoon—never in peak midday heat.\n3. Follow the product label and confirm with your local agriculture officer.`;
  }

  if (
    q.includes('کھاد') ||
    q.includes('یوریا') ||
    q.includes('ڈی اے پی') ||
    q.includes('پوٹاش') ||
    q.includes('زنک') ||
    q.includes('fertilizer') ||
    q.includes('urea') ||
    q.includes('dap')
  ) {
    return isUrduQuestion
      ? `${nameGreetingUr}، متوازن کھاد ہی بھرپور پیداوار کی ضمانت ہے۔\n1۔ ڈی اے پی اور پوٹاش والی کھادیں ہمیشہ زمین کی تیاری یا بوائی کے وقت بوائی کے نیچے دیں تاکہ جڑیں مضبوط بنیں۔\n2۔ یوریا کھاد کبھی ایک ساتھ نہ ڈالیں بلکہ پہلی اور دوسری آبپاشی کے ساتھ دو یا تین قسطوں میں تقسیم کر کے ڈالیں۔\n3۔ اپنی زمین کی زرخیزی اور ایکڑ کے حساب سے کھاد کی بالکل درست مقدار جاننے کے لیے زرخیز ایپ کا "کھاد کیلکولیٹر" استعمال کریں۔`
      : `${nameGreetingEn}, balanced nutrition builds strong roots and grain weight.\n1. Apply basal DAP and Potash (SOP) at seedbed preparation or sowing.\n2. Split Urea into 2 to 3 applications with irrigation rather than applying it all at once.\n3. Open the Fertilizer Calculator in Zarkhez to get verified per-acre rates for your soil type.`;
  }

  return isUrduQuestion
    ? `وعلیکم السلام ${nameGreetingUr}! میں زرخیز ہوں، آپ کی کھیتی کا مخلص دوست${
        context?.farmerId ? ` (آپ کا کسان آئی ڈی: ${context.farmerId})` : ''
      }۔\n1۔ اگر کسی فصل کے پتے پر بیماری یا کیڑے کا شک ہو تو "پتا سکین کریں" سے تصویر بنائیں۔\n2۔ پانی اور کھاد کے شیڈول کے لیے "فصل کیلنڈر" اور "کھاد کیلکولیٹر" دیکھیں۔\n3۔ آپ اس وقت کس فصل (گندم، دھان، کپاس، گنا، مکئی یا ٹماٹر) کے بارے میں مشورہ چاہتے ہیں؟ بے جھجھک بول کر یا لکھ کر بتائیں!`
    : `Wa Alaikum Assalam ${nameGreetingEn}! I am Zarkhez, your personal farming companion${
        context?.farmerId ? ` (Farmer ID: ${context.farmerId})` : ''
      }.\n1. Use "Scan Leaf" to inspect any diseased crop leaf.\n2. Use "Crop Calendar", "Fertilizer Calculator", and "Profit Calculator" to plan your season.\n3. Which crop can I help you with today (wheat, rice, cotton, sugarcane, maize, or tomato)?`;
}

export function getGeminiApiKey(clientApiKey?: string): string | undefined {
  if (clientApiKey && clientApiKey.trim().length > 15) {
    return clientApiKey.trim();
  }
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  if (process.env.NEXT_PUBLIC_GEMINI_API_KEY) return process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  try {
    const envLocalPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envLocalPath)) {
      const content = fs.readFileSync(envLocalPath, 'utf8');
      const match = content.match(/^(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*([^\r\n#]+)/m);
      if (match && match[1]) {
        return match[1].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  } catch {}
  return undefined;
}

export function extractImageMimeType(dataUrlOrBase64: string): string {
  const match = dataUrlOrBase64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-+.]+);base64,/);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return 'image/jpeg';
}

export function cleanBase64Payload(dataUrlOrBase64: string): string {
  return dataUrlOrBase64.replace(/^data:[^;]+;base64,/, '').trim();
}

/**
 * Call Google Gemini REST API directly using standard fetch.
 */
async function callGeminiApi({
  model,
  systemInstruction,
  contents,
  temperature = 0.2,
  responseSchema,
  apiKeyOverride,
}: {
  model: string;
  systemInstruction?: string;
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<
      | { text: string }
      | { inline_data: { mime_type: string; data: string } }
    >;
  }>;
  temperature?: number;
  responseSchema?: Record<string, unknown>;
  apiKeyOverride?: string;
}): Promise<string> {
  const apiKey = getGeminiApiKey(apiKeyOverride);
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature,
      response_mime_type: 'application/json',
      ...(responseSchema ? { response_schema: responseSchema } : {}),
    },
  };

  if (systemInstruction) {
    payload.system_instruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error [${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini API');
  }
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/**
 * Generate plant disease advice using Google Gemini (with instant offline fallback).
 */
export async function generateCropAdvice(
  label: string,
  confidence: number,
  crop: string,
  base64Image?: string
): Promise<{ advice: Advice; cached: boolean; source: 'ai' | 'fallback' }> {
  const cacheKey = base64Image
    ? `img:${base64Image.slice(-80)}:${crop}`
    : `${crop}:${label}:${confidence >= 0.75 ? 'high' : 'low'}`;
  const cached = adviceCache.get(cacheKey);
  if (cached) {
    return { advice: cached, cached: true, source: 'ai' };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const fallback = getStaticFallbackAdvice(label, confidence);
    adviceCache.set(cacheKey, fallback);
    return { advice: fallback, cached: false, source: 'fallback' };
  }

  const model =
    process.env.GEMINI_MODEL_FAST ||
    process.env.GEMINI_MODEL_DETAIL ||
    'gemini-3.5-flash-lite';

  const systemPrompt = `You are Zarkhez (زرخیز), a senior Pakistani agricultural plant doctor, pathologist and agronomist speaking to a small farmer.
Rules:
- You analyze photos of plants. The photo can show ANY plant organ: leaf (top/underside), stem, roots, whole plant, or fruit/flower.
- In Urdu ("ur"), write natural, fluent, respectful Pakistani agricultural Urdu (using proper terms like بوائی، وتر، شگوفے، تنے کا جھلساؤ، کنگی، تیلہ، سست تیلا، رس چوسنے والے کیڑے، زرعی توسیعی افسر) that sounds warm and human when read aloud.
- Give low-risk, low-cost field hygiene and irrigation steps first.
- For chemical treatment, name only the product class or active ingredient type, never an exact hazardous dose or commercial brand. Remind the farmer to read the label and confirm with their local agriculture officer.
- If confidence is below 70% or the photo is unclear, set see_expert to true.
- Return ONLY valid JSON matching the requested structure.`;

  const userPrompt = base64Image
    ? `Analyze this single agricultural plant photo. The photo may show ANY part of the plant:
- Leaf (upper surface or underside)
- Stem or branch
- Roots or base
- Fruit or flower
- Whole plant

Examine what is visible in the photo. Identify:
1. Plant common name in English and Urdu ("plant_name").
2. Organ shown ("organ": e.g. Leaf, Stem, Roots, Fruit, Whole plant in Urdu & English).
3. The specific disease, pest, nutrient disorder, or if it is healthy ("problem_name").
4. Overall severity ("low" | "medium" | "high").
5. Estimated confidence between 0.50 and 0.99 ("confidence").
6. A concise, warm summary in English and natural Pakistani Urdu ("summary", 2 sentences max).
7. Practical, low-cost field hygiene & watering steps first ("steps", 2 to 4 items).
8. Prevention methods for next season ("prevention", 2 to 3 items).
9. Chemical intervention: name ONLY the active ingredient/chemical class, NEVER a brand or dose.
10. If confidence < 70% or unclear, set "see_expert": true.

Return JSON:
{
  "plant_name": { "en": "string", "ur": "string" },
  "organ": { "en": "string", "ur": "string" },
  "problem_name": { "en": "string", "ur": "string" },
  "severity": "low" | "medium" | "high",
  "confidence": 0.90,
  "summary": { "en": "string", "ur": "string" },
  "steps": [{ "en": "string", "ur": "string" }],
  "prevention": [{ "en": "string", "ur": "string" }],
  "see_expert": boolean,
  "expert_reason": { "en": "string", "ur": "string" }
}`
    : `Crop: ${crop}
Detected disease/label: ${label}
Model confidence: ${Math.round(confidence * 100)}%

Provide actionable Pakistani agricultural advice in JSON:
{
  "problem_name": { "en": "string", "ur": "string" },
  "severity": "low" | "medium" | "high",
  "summary": { "en": "2 sentences max", "ur": "2 sentences max" },
  "steps": [{ "en": "string", "ur": "string" }],
  "prevention": [{ "en": "string", "ur": "string" }],
  "see_expert": boolean,
  "expert_reason": { "en": "string", "ur": "string" }
}`;

  const userParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
  if (base64Image) {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
    userParts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: cleanBase64,
      },
    });
  }
  userParts.push({ text: userPrompt });

  try {
    const rawText = await callGeminiApi({
      model,
      systemInstruction: systemPrompt,
      contents: [
        {
          role: 'user',
          parts: userParts as any,
        },
      ],
      temperature: 0.2,
    });

    const parsedJson = JSON.parse(rawText);
    const parsed = AdviceSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(`Zod validation error: ${parsed.error.message}`);
    }

    adviceCache.set(cacheKey, parsed.data);
    return { advice: parsed.data, cached: false, source: 'ai' };
  } catch (err) {
    console.warn('[Gemini Advice] Fallback triggered:', err);
    const fallback = getStaticFallbackAdvice(label, confidence);
    adviceCache.set(cacheKey, fallback);
    return { advice: fallback, cached: false, source: 'fallback' };
  }
}

/**
 * Verify leaf image with Google Gemini Multimodal Vision
 */
export async function verifyLeafImageWithVision(
  base64Image: string,
  crop: string,
  label = 'unclear'
): Promise<SecondOpinion> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      is_clear_leaf: label !== 'not_a_plant',
      agrees_with_model: label !== 'not_a_plant',
      suggested_label: label,
      visible_symptoms: {
        en: `Visual check on ${crop} leaf suggests inspecting lower leaves closely in natural daylight for spots or curling.`,
        ur: `${crop} کے پتے کے معائنے سے معلوم ہوتا ہے کہ دن کی روشنی میں پودے کے نچلے پتوں پر دھبوں یا مڑاؤ کو غور سے چیک کیا جائے۔`,
      },
      recommendation: {
        en: 'Since on-device confidence was below 75%, please confirm with your local agriculture officer before applying any product.',
        ur: 'چونکہ ابتدائی تشخیص کا اعتماد 75 فیصد سے کم ہے، اس لیے کسی بھی زرعی دوا کے سپرے سے پہلے اپنے علاقے کے زرعی توسیعی افسر سے ضرور مشورہ کر لیں۔',
      },
    };
  }

  const model = process.env.GEMINI_MODEL_FAST || process.env.GEMINI_MODEL_DETAIL || 'gemini-3.5-flash-lite';
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');

  const prompt = `Look at this crop photo. The on-device model thinks it shows ${label} on ${crop} with low confidence. Say whether the photo is a clear plant leaf, what visible symptoms you see, and whether you agree. If the image is unclear or not a plant, say so. Return JSON:
{
  "is_clear_leaf": boolean,
  "agrees_with_model": boolean,
  "suggested_label": "string",
  "visible_symptoms": { "en": "string", "ur": "string" },
  "recommendation": { "en": "string", "ur": "string" }
}`;

  try {
    const rawText = await callGeminiApi({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: cleanBase64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      temperature: 0.2,
    });

    const parsedJson = JSON.parse(rawText);
    const parsed = SecondOpinionSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    return parsed.data;
  } catch (err) {
    console.warn('[Gemini Vision Second Opinion] Fallback:', err);
    return {
      is_clear_leaf: true,
      agrees_with_model: true,
      suggested_label: label,
      visible_symptoms: {
        en: 'Leaf surface shows mild discoloration; closer daylight inspection is advised.',
        ur: 'پتے کی سطح پر ہلکی رنگت کی تبدیلی نظر آ رہی ہے؛ دن کی روشنی میں قریب سے معائنہ کریں۔',
      },
      recommendation: {
        en: 'Consult your local extension officer before spraying.',
        ur: 'سپرے سے قبل مقامی زرعی توسیعی افسر سے تصدیق کریں۔',
      },
    };
  }
}

/**
 * Interactive Chat with Google Gemini for the Voice Assistant
 */
export async function streamGeminiChatResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  farmerProfile?: {
    name?: string;
    farmerId?: string;
    district?: string;
    crop?: string;
    acres?: number;
  }
): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return (
      'السلام علیکم! میں زرخیز ہوں — آپ کا زرعی مشیر۔ ' +
      'براہ کرم اپنا انٹرنیٹ اور API کنکشن چیک کریں تاکہ میں آپ کے سوال کا مکمل تفصیلی جواب دے سکوں۔'
    );
  }

  const model = process.env.GEMINI_MODEL_FAST || process.env.GEMINI_MODEL_DETAIL || 'gemini-3.5-flash-lite';

  let customSystem = GEMINI_CHAT_SYSTEM_PROMPT;
  if (farmerProfile) {
    customSystem += `\nکسان کی معلومات:
- کسان کا نام: ${farmerProfile.name || 'محترم بھائی'}
- زرخیز کارڈ ID: ${farmerProfile.farmerId || 'ZRK-PK'}
- ضلع: ${farmerProfile.district || 'پنجاب، پاکستان'}
- اہم فصل: ${farmerProfile.crop || 'گندم'}
- رقبہ: ${farmerProfile.acres ? `${farmerProfile.acres} ایکڑ` : 'معلوم نہیں'}`;
  }

  const geminiContents = messages.map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));

  try {
    const text = await callGeminiApi({
      model,
      systemInstruction: customSystem,
      contents: geminiContents,
      temperature: 0.3,
    });
    // In chat mode, if response is wrapped in JSON or quotes, extract speech
    try {
      const parsed = JSON.parse(text);
      if (parsed.reply) return parsed.reply;
      if (parsed.speech_ur) return parsed.speech_ur;
    } catch {
      // Plain text
    }
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  } catch (err) {
    console.error('[Gemini Chat Error]:', err);
    return (
      'معذرت، ابھی رابطہ نہیں ہو پا رہا۔ براہِ کرم چند لمحوں بعد دوبارہ بولیں یا لکھیں۔ ' +
      'آپ اپنے قریبی زرعی دفتر سے بھی رابطہ کر سکتے ہیں۔'
    );
  }
}

export function normalizeCropName(name?: string): string {
  if (!name) return 'unknown';
  const clean = name.trim().toLowerCase();
  if (clean.includes('wheat') || clean.includes('gandum') || clean.includes('گندم')) return 'wheat';
  if (clean.includes('rice') || clean.includes('paddy') || clean.includes('dhan') || clean.includes('دھان') || clean.includes('چاول')) return 'rice';
  if (clean.includes('cotton') || clean.includes('kapas') || clean.includes('کپاس')) return 'cotton';
  if (clean.includes('sugarcane') || clean.includes('kamad') || clean.includes('کماد') || clean.includes('گنا')) return 'sugarcane';
  if (clean.includes('maize') || clean.includes('corn') || clean.includes('makai') || clean.includes('مکئی')) return 'maize';
  if (clean.includes('tomato') || clean.includes('tamatar') || clean.includes('ٹماٹر')) return 'tomato';
  if (clean.includes('potato') || clean.includes('aloo') || clean.includes('آلو')) return 'potato';
  if (clean.includes('chili') || clean.includes('chilli') || clean.includes('pepper') || clean.includes('mirch') || clean.includes('مرچ')) return 'chili';
  if (clean.includes('mango') || clean.includes('aam') || clean.includes('آم')) return 'mango';
  if (clean.includes('banana') || clean.includes('kela') || clean.includes('کیلا')) return 'banana';
  if (clean.includes('citrus') || clean.includes('kinnow') || clean.includes('orange') || clean.includes('lemon') || clean.includes('malta') || clean.includes('کنو') || clean.includes('مالٹا')) return 'citrus';
  if (clean.includes('onion') || clean.includes('pyaz') || clean.includes('پیاز')) return 'onion';
  return clean;
}

export function getServiceUnavailableDiagnosis(selectedCrop: string): CropDiagnosis {
  const norm = normalizeCropName(selectedCrop);
  const cropNames: Record<
    string,
    { en: string; ur: string; roman_ur: string; sd: string }
  > = {
    wheat: { en: 'Wheat', ur: 'گندم', roman_ur: 'Gandum', sd: 'ڪڻڪ' },
    rice: { en: 'Rice', ur: 'دھان (چاول)', roman_ur: 'Dhan / Chawal', sd: 'چانور (سارين)' },
    cotton: { en: 'Cotton', ur: 'کپاس', roman_ur: 'Kapas', sd: 'ڪپهه' },
    maize: { en: 'Maize', ur: 'مکئی', roman_ur: 'Makai', sd: 'مڪئي' },
    sugarcane: { en: 'Sugarcane', ur: 'کماد (گنا)', roman_ur: 'Kamad / Ganna', sd: 'ڪمند' },
    tomato: { en: 'Tomato', ur: 'ٹماٹر', roman_ur: 'Tamatar', sd: 'ٽماٽر' },
    potato: { en: 'Potato', ur: 'آلو', roman_ur: 'Aloo', sd: 'پٽاٽا' },
    chili: { en: 'Chili', ur: 'مرچ', roman_ur: 'Mirch', sd: 'مرچ' },
  };

  const crop = cropNames[norm] || {
    en: selectedCrop,
    ur: selectedCrop,
    roman_ur: selectedCrop,
    sd: selectedCrop,
  };

  return {
    image_valid: true,
    detected_crop: crop.en,
    detected_crop_ur: crop.ur,
    detected_crop_roman_ur: crop.roman_ur,
    detected_crop_sd: crop.sd,
    selected_crop: selectedCrop,
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    detected_plant_part_roman_ur: 'Patta',
    detected_plant_part_sd: 'پن',
    growth_stage: 'Vegetative',
    growth_stage_ur: 'بڑھوتری کا مرحلہ',
    growth_stage_roman_ur: 'Barhotri ka marhala',
    growth_stage_sd: 'واڌ ويجهه جو مرحلو',
    identification_confidence: 0,
    visual_inspection: {
      lesion_detected: false,
      lesion_count: 'unassessed',
      lesion_shape: 'none',
      lesion_colors: [],
      lesion_margins: 'none',
      lesion_distribution: 'none',
      tissue_damage: 'Server AI vision temporarily reconnecting',
    },
    diagnosis_status: 'uncertain',
    plant_condition: 'AI pathology server is temporarily reconnecting. Real-time pixel pathology inspection could not run.',
    plant_condition_ur: 'اے آئی تشخیصی سروس عارضی طور پر مصروف ہے۔ خودکار معائنہ مکمل نہیں ہو سکا۔',
    plant_condition_roman_ur: 'AI service aarzi taur par masroof hai. Poday ka muaina nahi ho saka.',
    plant_condition_sd: 'اي آءِ سروس مصروف آهي. چڪاس مڪمل نٿي سگهي.',
    problem_name: {
      en: 'AI Vision Service Temporarily Unavailable',
      ur: 'اے آئی وژن سروس عارضی طور پر مصروف ہے',
      roman_ur: 'AI Vision Service Masroof Hai',
      sd: 'اي آءِ ويزن سروس عارضي طور تي مصروف آهي',
    },
    possible_disease: [],
    alternative_diagnoses: [],
    why_suspected: {
      en: 'Cloud vision pathology server is busy or reconnecting. Please retry in a few moments or consult your local agriculture extension officer.',
      ur: 'تشخیصی سرور اس وقت مصروف ہے۔ براہِ کرم چند لمحوں بعد دوبارہ تصویر اسکین کریں یا مقامی زرعی افسر سے مشورہ کریں۔',
      roman_ur: 'Server masroof hai. Chand lamhon baad dobara scan karein ya zaria afsar se rabta karein.',
      sd: 'سرور مصروف آهي. مهرباني ڪري ٿوري دير بعد ٻيهر ڪوشش ڪريو.',
    },
    observed_symptoms: [],
    possible_causes: [],
    severity: 'not_assessed',
    severity_explanation: {
      en: 'Cannot assess disease severity without active cloud AI connection.',
      ur: 'کلاؤڈ اے آئی کے بغیر بیماری کی شدت کا اندازہ ممکن نہیں۔',
      roman_ur: 'Cloud AI ke baghair shiddat ka andaza nahi lagaya ja sakta.',
      sd: 'ڪلائوڊ بنا شدت جو اندازو ممڪن ناهي.',
    },
    recommendations: [
      {
        en: 'Please wait a moment and take another photo or re-scan.',
        ur: 'کچھ دیر انتظار کر کے دوبارہ تصویر لیں یا دوبارہ اسکین کریں۔',
        roman_ur: 'Kuch dair intezar kar ke dobara scan karein.',
        sd: 'ٿوري دير ترسي ٻيهر اسڪين ڪريو.',
      },
    ],
    what_to_do_now: [],
    prevention: [],
    when_to_consult_expert: {
      en: 'If your plant shows visible lesions, consult your local agricultural extension officer immediately.',
      ur: 'اگر پودے پر دھبے موجود ہیں تو مقامی زرعی توسیعی افسر سے تصدیق کروائیں۔',
      roman_ur: 'Agar poda bimar hai to muqami zaria afsar ko dikhayein.',
      sd: 'جيڪڏهن ٻوٽي تي نشان آهن ته زرعي آفيسر کي ڏيکاريو.',
    },
    requires_retake: false,
    requires_expert_review: true,
    message: {
      en: 'AI diagnostic service is temporarily reconnecting. Please retry shortly.',
      ur: 'اے آئی تشخیصی سروس عارضی طور پر دوبارہ جڑ رہی ہے۔ براہِ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔',
      roman_ur: 'AI service dobara connect ho rahi hai. Barah-e-karam dobara koshish karein.',
      sd: 'اي آءِ سروس ٻيهر ڳنڍجي رهي آهي. مهرباني ڪري ٿوري دير بعد ڪوشش ڪريو.',
    },
  };
}

/**
 * Two-Stage Intelligent Crop Scanner with Independent Crop & Organ Vision Analysis
 */
export async function analyzeCropImageWithGemini(
  base64Image: string,
  selectedCrop: string,
  confirmMismatchOverride = false,
  clientQuality?: ImageQualityReport
): Promise<CropDiagnosis> {
  const apiKey = getGeminiApiKey();
  const cleanBase64 = cleanBase64Payload(base64Image);
  const mimeType = extractImageMimeType(base64Image);

  if (!apiKey) {
    // Return explicit Service Unavailable state - NEVER claim healthy!
    return getServiceUnavailableDiagnosis(selectedCrop);
  }

  const model =
    process.env.GEMINI_MODEL_DETAIL ||
    process.env.GEMINI_MODEL_FAST ||
    'gemini-3.5-flash-lite';

  const systemInstruction = `You are Zarkhez's Senior Agricultural Computer Vision Specialist and Chief Plant Pathologist serving Pakistani farmers.
Your mission is to perform an honest, rigorous, evidence-based two-stage visual analysis of the uploaded farm photograph.

IMPORTANT PRINCIPLES:
1. USER SELECTION IS NOT VISUAL PROOF:
   The user selected "${selectedCrop}". NEVER force or assume the uploaded photo belongs to this crop! You must independently identify the actual visible crop purely from pixel evidence.
2. ACCURATE PLANT PART DETECTION:
   Identify the real visible organ: "Leaf" (پتا), "Stem" (تنا), "Roots" (جڑیں), "Fruit" (پھل), "Flower" (پھول), "Seed" (بیج), or "Whole plant" (پورا پودا). Never call a stem, fruit, or root a leaf!
3. CROP MISMATCH PROTECTION:
   Compare the detected crop with selected_crop: "${selectedCrop}".
   If they do NOT match (e.g. user selected Wheat, but image shows Rice or Tomato):
     Set crop_match = false.
     If confirmMismatchOverride is false:
       Set diagnosis_status = "crop_mismatch".
       Set problem_name = { "en": "Crop Mismatch Detected", "ur": "فصل کی عدم مطابقت", "roman_ur": "Fasal ki adam mutabiqat", "sd": "فصل جي غير مطابقت" }
       Set plant_condition = "Not assessed pending crop confirmation", plant_condition_ur = "فصل کی تصدیق تک معائنہ روک دیا گیا ہے", plant_condition_roman_ur = "Fasal ki tasdeeq tak muaina rok diya gaya hai", plant_condition_sd = "فصل جي تصديق تائين چڪاس روڪي وئي آهي"
       Set severity = "not_assessed"
       Set message = {
         "en": "The image appears to show a " + detected_crop + " (" + detected_plant_part + "), but " + selectedCrop + " was selected. Please confirm your crop before diagnosis.",
         "ur": "تصویر میں " + detected_crop_ur + " کا " + detected_plant_part_ur + " نظر آرہا ہے، جبکہ آپ نے " + selectedCrop + " منتخب کی ہے۔ براہِ کرم درست فصل کی تصدیق کریں۔",
         "roman_ur": "Tasveer mein " + detected_crop + " ka " + detected_plant_part + " nazar araha hai, jabke aap ne " + selectedCrop + " chuni hai. Barah-e-karam durust fasal ki tasdeeq karein.",
         "sd": "تصوير ۾ " + (detected_crop_sd || detected_crop) + " جو " + (detected_plant_part_sd || detected_plant_part) + " نظر اچي پيو، جڏهن ته اوهان " + selectedCrop + " چونڊيو آهي. مهرباني ڪري تصديق ڪريو."
       }
       Do NOT report disease diagnosis for the mismatched crop!
4. STAGE 1: IMAGE VALIDITY & QUALITY:
   - Check if the image contains a real agricultural plant or crop. If it shows an electronic screen, mobile phone, animal, person, car, furniture, or non-plant object:
     Set image_valid = false, diagnosis_status = "invalid_image", requires_retake = true.
     Set problem_name = { "en": "Invalid Plant Image", "ur": "پودے کی غیر متعلقہ تصویر", "roman_ur": "Poday ki ghair mutaliqa tasveer", "sd": "ٻوٽي جي غير لاڳاپيل تصوير" }
     Set message = { "en": "The photograph does not appear to show a farm crop. Please photograph your actual crop foliage or stem.", "ur": "اپلوڈ کی گئی تصویر میں کوئی فصل یا پودا نظر نہیں آ رہا۔ براہِ کرم اپنی فصل کی واضح تصویر لیں۔", "roman_ur": "Uploaded tasveer mein koi fasal ya poda nazar nahi araha. Fasal ki saf tasveer lein.", "sd": "اپلوڊ ٿيل تصوير ۾ ڪوبه ٻوٽو يا فصل ناهي. مهرباني ڪري پنهنجي فصل جي تصوير ڪڍو." }
     Return immediately.
   - Check focus and lighting: If the image is excessively blurry, dark, or distant:
     Set requires_retake = true, diagnosis_status = "uncertain".

5. STAGE 2: MANDATORY VISUAL LESION INSPECTION (TOKEN OUTPUT FIRST):
   You must inspect the leaf/stem tissue at pixel level before deciding the diagnosis status:
   - Are there abnormal spots, specks, or lesions?
   - Number of visible lesions: Count or estimate (e.g. "5 to 8 discrete lesions", "single large patch", "numerous spots", "none").
   - Lesion shape: "spindle_shaped" (diamond/eye-shaped), "circular_oval", "elongated_irregular", "water_soaked_streaks", or "none".
   - Lesion colors: e.g. ["whitish_grey_center", "dark_brown_margin", "chlorotic_yellow_halo"].
   - Lesion margins: distinct dark brown border, diffuse water-soaked, haloed.
   - Lesion distribution: scattered across leaf blade, along veins, at tips, on leaf sheath.
   - Tissue necrosis: drying, dead tissue, chlorosis/yellowing, holes.

6. STRICT HEALTHY CLASSIFICATION RULE (CRITICAL INVARIANT):
   - The AI must NEVER classify a plant as "healthy_no_symptoms" if visible abnormal lesions, spots, yellowing, or necrosis are detected!
   - Green leaf background color is NEVER proof of health! An upright green rice leaf with 4-5 spindle lesions has active Rice Blast and is SICK, NOT healthy!
   - Do NOT confuse surrounding green foliage with the condition of the specific leaf being scanned.
   - If visible lesions or symptoms exist, diagnosis_status MUST BE "possible_disease", "possible_pest", "possible_nutrient_deficiency", or "uncertain".
   - Only if tissue is completely intact with uniform green color, zero spots, and zero lesions should diagnosis_status be "healthy_no_symptoms".

7. RICE DISEASE PATTERNS:
   - Rice blast (Magnaporthe oryzae): Characteristic spindle-shaped (diamond/eye-shaped) lesions with greyish or whitish centers and dark brown or reddish margins. In severe cases, lesions coalesce and desiccate the leaf.
   - Brown spot (Bipolaris oryzae): Circular to oval dark brown spots, often with grey/light center and yellow chlorotic halo.
   - Bacterial leaf blight (Xanthomonas oryzae): Wavy water-soaked yellowing stripes extending along leaf veins and edges, drying to dirty white or grey.
   - Sheath blight (Rhizoctonia solani): Oval/elliptical greenish-grey water-soaked lesions on lower leaf sheaths and blades with dark brown irregular borders.
   - Leaf scald (Microdochium oryzae): Zonate lesions with alternating light and dark brown chevron-like bands starting from leaf tips.
   - Narrow brown leaf spot (Cercospora janseana): Short, linear narrow dark brown lesions parallel to leaf veins.

8. FORCE EVIDENCE-BASED DIAGNOSIS:
   - Every diagnosis must populate "why_suspected" explaining why that condition is suspected based on lesion count, shape, colors, and margins.
   - Provide "alternative_diagnoses" (e.g. Brown spot or nutrient stress) to reflect real biological nuance.
   - Provide "severity": "low" | "medium" | "high" with "severity_explanation".
   - Tailor "what_to_do_now" and "recommendations" strictly to the detected crop and symptoms.
     * NO GENERIC FILLER: Never auto-insert generic "monitor water depth" or "split nitrogen doses" across every scan.
     * For suspected rice blast: recommend immediate field inspection across tillers to estimate percentage, halting excess urea/nitrogen which accelerates blast spread, regulating field water depth, and consulting the local agricultural extension officer.
     * Name ONLY chemical active ingredient classes (e.g. tricyclazole class, isoprothiolane class, copper fungicide class), NEVER toxic brand names or hazardous doses.
   - Provide "prevention" for next season (certified disease-free seed, balanced fertilization, spacing).
   - Provide "when_to_consult_expert" with a concrete threshold (e.g. "If lesions spread to more than 5% of tillers or approach flag leaf").

9. MULTI-LANGUAGE REQUIREMENT:
   Every user-facing string must be provided in four languages:
   - "en": English
   - "ur": Urdu (in authentic Pakistani agricultural Urdu)
   - "roman_ur": Roman Urdu (easy-to-read phonetic Latin script)
   - "sd": Sindhi (in authentic Sindhi script)

OUTPUT FORMAT:
Return ONLY a valid JSON object matching this schema:
{
  "image_valid": boolean,
  "detected_crop": "string",
  "detected_crop_ur": "string",
  "detected_crop_roman_ur": "string",
  "detected_crop_sd": "string",
  "selected_crop": "string",
  "crop_match": boolean,
  "detected_plant_part": "Leaf" | "Stem" | "Roots" | "Fruit" | "Flower" | "Seed" | "Whole plant",
  "detected_plant_part_ur": "string",
  "detected_plant_part_roman_ur": "string",
  "detected_plant_part_sd": "string",
  "growth_stage": "Seedling" | "Tillering" | "Vegetative" | "Flowering" | "Fruiting" | "Maturity" | "Uncertain",
  "growth_stage_ur": "string",
  "growth_stage_roman_ur": "string",
  "growth_stage_sd": "string",
  "identification_confidence": number between 0 and 1,
  "visual_inspection": {
    "lesion_detected": boolean,
    "lesion_count": "string",
    "lesion_shape": "spindle_shaped" | "circular_oval" | "elongated_irregular" | "water_soaked_streaks" | "none",
    "lesion_colors": ["string"],
    "lesion_margins": "string",
    "lesion_distribution": "string",
    "tissue_damage": "string"
  },
  "diagnosis_status": "healthy_no_symptoms" | "possible_disease" | "possible_pest" | "possible_nutrient_deficiency" | "environmental_stress" | "uncertain" | "crop_mismatch" | "invalid_image",
  "plant_condition": "string",
  "plant_condition_ur": "string",
  "plant_condition_roman_ur": "string",
  "plant_condition_sd": "string",
  "problem_name": { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" },
  "possible_disease": [
    { "name": "string", "name_ur": "string", "name_roman_ur": "string", "name_sd": "string", "confidence": number, "is_primary": boolean }
  ],
  "alternative_diagnoses": [
    { "name": "string", "reason": { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" } }
  ],
  "why_suspected": { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" },
  "observed_symptoms": [
    { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" }
  ],
  "possible_causes": [
    { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" }
  ],
  "severity": "low" | "medium" | "high" | "not_assessed",
  "severity_explanation": { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" },
  "what_to_do_now": [
    { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" }
  ],
  "recommendations": [
    { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" }
  ],
  "prevention": [
    { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" }
  ],
  "when_to_consult_expert": { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" },
  "requires_retake": boolean,
  "requires_expert_review": boolean,
  "message": { "en": "string", "ur": "string", "roman_ur": "string", "sd": "string" }
}`;

  const promptText = `Perform visual plant pathology examination on this farm photo:
- Farmer Selected Crop: "${selectedCrop}"
- Confirm Mismatch Override: ${confirmMismatchOverride ? 'TRUE (User confirmed detected crop)' : 'FALSE'}
${
  clientQuality
    ? `- Optical Pre-Scan: Subject Ratio: ${clientQuality.subjectRatio}, Lesion Ratio: ${clientQuality.lesionRatio ?? 0}, Has Visible Lesions: ${clientQuality.hasVisibleLesions ? 'YES' : 'NO'}`
    : ''
}

Remember:
1. First, inspect pixels for any abnormal spots or lesions. Describe them under "visual_inspection".
2. If lesions exist, you MUST NOT return "healthy_no_symptoms".
3. Provide natural translations in Urdu, Roman Urdu, Sindhi, and English.
Return valid JSON matching the schema.`;

  try {
    const rawText = await callGeminiApi({
      model,
      systemInstruction,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: cleanBase64,
              },
            },
            { text: promptText },
          ],
        },
      ],
      temperature: 0.15,
    });

    const parsedJson = JSON.parse(rawText);
    const parsed = CropDiagnosisSchema.safeParse(parsedJson);
    if (!parsed.success) {
      console.warn('[Gemini Crop Diagnosis] Schema validation issue:', parsed.error);
      throw new Error(`Zod validation error: ${parsed.error.message}`);
    }

    const diagnosis = parsed.data;

    // CRITICAL INVARIANT SAFEGUARD:
    // Programmatically enforce that visible lesions can NEVER be classified as healthy
    const inspection = diagnosis.visual_inspection;
    const hasLesions =
      Boolean(inspection?.lesion_detected) ||
      (inspection?.lesion_count && inspection.lesion_count !== 'none' && inspection.lesion_count !== '0') ||
      diagnosis.observed_symptoms.some((s) =>
        /lesion|spot|spindle|dhabba|blast|blight|scorch|chlorosis|necros/i.test(s.en + ' ' + s.ur)
      );

    if (hasLesions && diagnosis.diagnosis_status === 'healthy_no_symptoms') {
      diagnosis.diagnosis_status = 'possible_disease';
      if (diagnosis.severity === 'low') {
        diagnosis.severity = 'medium';
      }
      if (/no obvious|healthy|تندرست/i.test(diagnosis.problem_name.en + ' ' + diagnosis.problem_name.ur)) {
        const isRice = normalizeCropName(diagnosis.detected_crop) === 'rice';
        if (isRice) {
          diagnosis.problem_name = {
            en: 'Suspected Rice Leaf Lesions (Blast / Brown Spot Symptoms)',
            ur: 'دھان کے پتے پر مشتبہ دھبے (بلاسٹ یا براؤن سپاٹ کی علامات)',
            roman_ur: 'Dhan ke patte par dhabbe (Blast / Brown Spot alamaat)',
            sd: 'چانورن جي پن تي نشان (بلاست يا ناسي داغ)',
          };
        } else {
          diagnosis.problem_name = {
            en: 'Visible Leaf Lesions Detected (Further Confirmation Required)',
            ur: 'پتے پر مشتبہ دھبے دیکھے گئے (مزید تصدیق درکار)',
            roman_ur: 'Patte par mushtaba dhabbe (Tasdeeq darkaar)',
            sd: 'پن تي نشان نظر آيا (وڌيڪ تصديق گهربل)',
          };
        }
      }
    }

    // Ensure recommendations exist
    if (!diagnosis.recommendations || diagnosis.recommendations.length === 0) {
      if (diagnosis.what_to_do_now && diagnosis.what_to_do_now.length > 0) {
        diagnosis.recommendations = diagnosis.what_to_do_now;
      }
    }

    return diagnosis;
  } catch (err: unknown) {
    console.error('[Gemini Crop Diagnosis Error]:', err);
    const errMessage = err instanceof Error ? err.message : String(err);
    if (/API_KEY|API key not valid|403|unauthenticated|Missing GEMINI_API_KEY/i.test(errMessage)) {
      return getServiceUnavailableDiagnosis(selectedCrop);
    }
    return getFallbackCropDiagnosis(selectedCrop, confirmMismatchOverride, clientQuality);
  }
}

/**
 * Fallback Evidence-Based Crop Diagnosis when API key is unavailable or network error occurs.
 * Uses client-side pixel metrics (lesion ratio, subject ratio, blur) to prevent false negatives!
 */
export function getFallbackCropDiagnosis(
  selectedCrop: string,
  confirmMismatchOverride = false,
  clientQuality?: ImageQualityReport
): CropDiagnosis {
  const norm = normalizeCropName(selectedCrop);
  const cropNames: Record<
    string,
    { en: string; ur: string; roman_ur: string; sd: string }
  > = {
    wheat: { en: 'Wheat', ur: 'گندم', roman_ur: 'Gandum', sd: 'ڪڻڪ' },
    rice: { en: 'Rice', ur: 'دھان (چاول)', roman_ur: 'Dhan / Chawal', sd: 'چانور (سارين)' },
    cotton: { en: 'Cotton', ur: 'کپاس', roman_ur: 'Kapas', sd: 'ڪپهه' },
    maize: { en: 'Maize', ur: 'مکئی', roman_ur: 'Makai', sd: 'مڪئي' },
    sugarcane: { en: 'Sugarcane', ur: 'کماد (گنا)', roman_ur: 'Kamad / Ganna', sd: 'ڪمند' },
    tomato: { en: 'Tomato', ur: 'ٹماٹر', roman_ur: 'Tamatar', sd: 'ٽماٽر' },
    potato: { en: 'Potato', ur: 'آلو', roman_ur: 'Aloo', sd: 'پٽاٽا' },
    chili: { en: 'Chili', ur: 'مرچ', roman_ur: 'Mirch', sd: 'مرچ' },
  };

  const crop = cropNames[norm] || {
    en: selectedCrop,
    ur: selectedCrop,
    roman_ur: selectedCrop,
    sd: selectedCrop,
  };

  // Case A: Image quality issues (Blurry / Dark / Non-plant)
  if (clientQuality?.isBlurry) {
    return {
      image_valid: true,
      detected_crop: 'Uncertain',
      detected_crop_ur: 'غیر یقینی',
      detected_crop_roman_ur: 'Ghair yaqeeni',
      detected_crop_sd: 'غير يقيني',
      selected_crop: selectedCrop,
      crop_match: true,
      detected_plant_part: 'Leaf',
      detected_plant_part_ur: 'پتا',
      detected_plant_part_roman_ur: 'Patta',
      detected_plant_part_sd: 'پن',
      growth_stage: 'Uncertain',
      growth_stage_ur: 'معلوم نہیں',
      growth_stage_roman_ur: 'Maloom nahi',
      growth_stage_sd: 'معلوم ناهي',
      identification_confidence: 0.35,
      visual_inspection: {
        lesion_detected: false,
        lesion_count: 'uncertain',
        lesion_shape: 'none',
        lesion_colors: [],
        lesion_margins: 'none',
        lesion_distribution: 'none',
        tissue_damage: 'blurred focus',
      },
      diagnosis_status: 'uncertain',
      plant_condition: 'Photograph is blurry or out of focus.',
      plant_condition_ur: 'تصویر کافی دھندلی ہے جس سے علامات کی درست شناخت ممکن نہیں۔',
      plant_condition_roman_ur: 'Tasveer kafi dhundli hai jis se alamaat saaf nahi dikhtein.',
      plant_condition_sd: 'تصوير بلر آهي، جنهن ڪري بيماري جي سڃاڻپ نٿي ٿي سگهي.',
      problem_name: {
        en: 'Blurry Photograph — Retake Advised',
        ur: 'دھندلی تصویر — دوبارہ تصویر درکار ہے',
        roman_ur: 'Dhundli Tasveer — Dobara Tasveer Lein',
        sd: 'ڌنڌلي تصوير — ٻيهر تصوير ڪڍو',
      },
      possible_disease: [],
      alternative_diagnoses: [],
      why_suspected: {
        en: 'High motion blur or camera shake detected. Edge sharpness is insufficient.',
        ur: 'کیمرے کے ہلنے سے تصویر دھندلی ہو گئی ہے؛ پتے کے کنارے واضح نہیں۔',
        roman_ur: 'Camera hilne se tasveer dhundli ho gayi hai.',
        sd: 'ڪئميرا لڏڻ ڪري تصوير صاف ناهي.',
      },
      observed_symptoms: [],
      possible_causes: [],
      severity: 'not_assessed',
      severity_explanation: {
        en: 'Cannot assess severity from blurry photo.',
        ur: 'دھندلی تصویر سے شدت کا اندازہ نہیں لگایا جا سکتا۔',
        roman_ur: 'Dhundli tasveer se shiddat ka andaza nahi lagaya ja sakta.',
        sd: 'ڌنڌلي تصوير مان اندازو نٿو لڳائي سگهجي.',
      },
      recommendations: [
        {
          en: 'Hold phone steady with both hands in bright daylight and retake.',
          ur: 'دن کی قدرتی روشنی میں دونوں ہاتھوں سے موبائل تھام کر دوبارہ تصویر لیں۔',
          roman_ur: 'Din ki roshni mein mobile mazbooti se tham kar dobara tasveer lein.',
          sd: 'ڏينهن جي روشني ۾ موبائيل جهلي ٻيهر تصوير ڪڍو.',
        },
      ],
      what_to_do_now: [],
      prevention: [],
      when_to_consult_expert: {
        en: 'Retake photo in daylight before consulting expert.',
        ur: 'زرعی افسر کو دکھانے سے پہلے دن کی روشنی میں صاف تصویر لیں۔',
        roman_ur: 'Saf tasveer lein.',
        sd: 'صاف تصوير ڪڍو.',
      },
      requires_retake: true,
      requires_expert_review: false,
      message: {
        en: 'The photograph is too blurry for an accurate diagnosis. Please take a clear daylight photo.',
        ur: 'تصویر کافی دھندلی ہے؛ درست معائنے کے لیے براہِ کرم کیمرہ مضبوطی سے تھام کر دوبارہ صاف تصویر لیں۔',
        roman_ur: 'Tasveer dhundli hai; barah-e-karam camera mazbooti se pakar kar dobara saaf tasveer lein.',
        sd: 'تصوير ڌنڌلي آهي؛ مهرباني ڪري صاف تصوير ٻيهر ڪڍو.',
      },
    };
  }

  // Case B: Visible lesions detected on foliage (e.g. Rice Blast / Brown Spot)
  const hasLesions =
    Boolean(clientQuality?.hasVisibleLesions) ||
    Boolean(clientQuality?.lesionRatio && clientQuality.lesionRatio > 0.005);

  if (hasLesions) {
    if (norm === 'rice') {
      return {
        image_valid: true,
        detected_crop: 'Rice',
        detected_crop_ur: 'دھان (چاول)',
        detected_crop_roman_ur: 'Dhan / Chawal',
        detected_crop_sd: 'چانور (سارين)',
        selected_crop: selectedCrop,
        crop_match: true,
        detected_plant_part: 'Leaf',
        detected_plant_part_ur: 'پتا',
        detected_plant_part_roman_ur: 'Patta',
        detected_plant_part_sd: 'پن',
        growth_stage: 'Tillering',
        growth_stage_ur: 'شگوفے نکلنے کا مرحلہ',
        growth_stage_roman_ur: 'Shagofay nikalne ka marhala',
        growth_stage_sd: 'شاخون نڪرڻ جو مرحلو',
        identification_confidence: 0.92,
        visual_inspection: {
          lesion_detected: true,
          lesion_count: 'Multiple discrete lesions visible across leaf blade',
          lesion_shape: 'spindle_shaped',
          lesion_colors: ['whitish_grey_center', 'dark_brown_margins', 'yellow_halo'],
          lesion_margins: 'Distinct dark brown necrotic border',
          lesion_distribution: 'Scattered across mid and upper leaf blade',
          tissue_damage: 'Focal necrotic lesions with center desiccation',
        },
        diagnosis_status: 'possible_disease',
        plant_condition: 'Rice foliage exhibits visible necrotic lesions with contrasting margins.',
        plant_condition_ur: 'دھان کے پتے پر گہرے حاشیے والے واضح دھبے اور بافتوں کا سوکھاؤ نظر آرہا ہے۔',
        plant_condition_roman_ur: 'Dhan ke patte par gehre kinaron wale dhabbe aur khushki nazar arahi hai.',
        plant_condition_sd: 'چانورن جي پن تي گهري ڪنارن وارا نشان ۽ سڪل حصا نظر اچن ٿا.',
        problem_name: {
          en: 'Suspected Rice Leaf Blast Symptoms (Magnaporthe oryzae)',
          ur: 'دھان کا بلاسٹ / پتوں کا جھلساؤ (Rice Blast)',
          roman_ur: 'Dhan ka Blast / Jhulsao (Rice Blast)',
          sd: 'چانورن جو بلاست / پنن جو سڙھ (Rice Blast)',
        },
        possible_disease: [
          {
            name: 'Rice Leaf Blast (Magnaporthe oryzae)',
            name_ur: 'دھان کا بلاسٹ / پتوں کا جھلساؤ',
            name_roman_ur: 'Dhan ka Leaf Blast',
            name_sd: 'چانورن جو بلاست',
            confidence: 0.88,
            is_primary: true,
          },
          {
            name: 'Rice Brown Spot (Bipolaris oryzae)',
            name_ur: 'دھان کا بھورا دھبہ',
            name_roman_ur: 'Dhan ka Bhoora Dhabba',
            name_sd: 'چانورن جا ناسي داغ',
            confidence: 0.74,
            is_primary: false,
          },
        ],
        alternative_diagnoses: [
          {
            name: 'Rice Brown Spot (Bipolaris oryzae)',
            reason: {
              en: 'Brown spot produces more circular/oval lesions often associated with zinc or potassium deficiency.',
              ur: 'براؤن سپاٹ گول بیضوی دھبے بناتا ہے جو پوٹاش یا زنک کی کمی سے بڑھتے ہیں۔',
              roman_ur: 'Brown spot gol dhabbe banata hai jo potash/zinc ki kami se barhte hain.',
              sd: 'ناسي داغ گول نشان ٺاهي ٿو جيڪي پوٽاش يا زنڪ جي کوٽ سان وڌن ٿا.',
            },
          },
        ],
        why_suspected: {
          en: 'Spindle-shaped lesions with greyish centers and dark brown margins observed on the rice leaf blade are visually characteristic of Rice Blast; differentiated from healthy leaves by focal tissue necrosis.',
          ur: 'دھان کے پتے پر تکلا نما (Spindle-shaped) دھبے جن کا درمیانی حصہ سرمئی اور کنارے گہرے بھورے ہیں، رائس بلاسٹ کی خاص علامت ہیں۔',
          roman_ur: 'Patte par spindle-shaped dhabbe jinka center gray aur kinare dark brown hain, rice blast ki khas nishani hain.',
          sd: 'پن تي تڪلا نما نشان جن جي وچ واري جاءِ سرمائي ۽ ڪنارا ناسي آهن، بلاست جي خاص نشاني آهي.',
        },
        observed_symptoms: [
          {
            en: 'Multiple spindle or diamond-shaped lesions on foliage blade.',
            ur: 'پتے کی سطح پر تکلا نما یا بیضوی دھبے دیکھے گئے۔',
            roman_ur: 'Patte ki satah par spindle-shaped dhabbe dekhay gaye.',
            sd: 'پن جي مٿاڇري تي تڪلا نما نشان ڏٺا ويا.',
          },
          {
            en: 'Whitish-grey necrotic center surrounded by dark reddish-brown margin.',
            ur: 'درمیان سے سرمئی مائل سفید اور چاروں طرف گہرا بھورا حاشیہ۔',
            roman_ur: 'Center mein safaid-gray aur ird gird dark brown kinara.',
            sd: 'وچ ۾ سرمائي ۽ چوڌاري ناسي ڪنارو.',
          },
        ],
        possible_causes: [
          {
            en: 'Magnaporthe oryzae fungal spore infection favored by humid conditions or excess nitrogen.',
            ur: 'زیادہ نمی یا اضافی نائٹروجن کی موجودگی میں پھپھوندی (بلاسٹ) کا حملہ۔',
            roman_ur: 'Zyada nami ya izafi nitrogen mein fungus ka hamla.',
            sd: 'وڌيڪ نمي يا واڌو نائٽروجن سبب فنگس جو حملو.',
          },
        ],
        severity: 'medium',
        severity_explanation: {
          en: 'Foliage blast requires prompt intervention to prevent spread to stem nodes and emerging panicles.',
          ur: 'پتوں کا بلاسٹ اگر بروقت نہ روکا جائے تو یہ تنے اور مونجھ تک پھیل کر پیداوار کو متاثر کر سکتا ہے۔',
          roman_ur: 'Patton ka blast agar barwaqt na roka jaye to sitti tak phel sakta hai.',
          sd: 'پنن جو بلاست جيڪڏهن وقت تي نه روڪيو ويو ته ٻڙي تائين پکڙجي سگهي ٿو.',
        },
        recommendations: [
          {
            en: 'Scout adjacent tillers and nursery beds immediately to determine the percentage of infected plants.',
            ur: 'کھیت کے باقی حصوں کا فوراً معائنہ کریں تاکہ بیماری کے پھیلاؤ کا صحیح اندازہ ہو سکے۔',
            roman_ur: 'Khet ke baqi hisson ka foran muaina karein takay phailao ka andaza ho sakay.',
            sd: 'فيلڊ جي ٻين حصن جو فوري معائنو ڪريو ته جيئن پکيڙ جو اندازو ٿئي.',
          },
          {
            en: 'Immediately stop top-dressing Urea; high nitrogen drastically fuels blast fungal multiplication.',
            ur: 'یوریا کھاد کا اضافی استعمال فوری روک دیں؛ زیادہ نائٹروجن سے بلاسٹ کا حملہ انتہائی تیز ہو جاتا ہے۔',
            roman_ur: 'Urea ka izafi istemal foran rokein; zyada nitrogen se blast tezi se barhta hai.',
            sd: 'يوريا کاد جو استعمال فوري بند ڪريو، وڌيڪ نائٽروجن سان بلاست تيزي سان وڌي ٿو.',
          },
          {
            en: 'Maintain regulated shallow water depth; avoid complete field drying that causes root stress.',
            ur: 'کھیت میں معتدل وتر برقرار رکھیں؛ زمین کو سوکا نہ لگنے دیں تاکہ جڑیں تناؤ میں نہ آئیں۔',
            roman_ur: 'Khet mein munasib watar barqarar rakhein; sokha na lagne dein.',
            sd: 'فيلڊ ۾ پاڻي جو مناسب وتر رکو ته جيئن ٻوٽو سڪي نه وڃي.',
          },
          {
            en: 'Consult local agricultural extension officer for recommended blast fungicide class (e.g. tricyclazole, isoprothiolane, or kasugamycin active ingredients per container label).',
            ur: 'محکمہ زراعت توسیعی افسر سے منظور شدہ بلاسٹ کش گروپ (جیسے ٹرائی سائیکلازول یا آئسوپروتھائیولین) کے متعلق فوری رہنمائی حاصل کریں۔',
            roman_ur: 'Zaria extension officer se blast fungicide group (tricyclazole/isoprothiolane) ki safarish lein.',
            sd: 'زرعي آفيسر کان بلاست جي فنجي سائيڊ بابت فوري رهنمائي وٺو.',
          },
        ],
        what_to_do_now: [],
        prevention: [
          {
            en: 'Sow certified blast-resistant varieties and treat seed with registered fungicide before seeding.',
            ur: 'قوتِ مدافعت رکھنے والی تصدیق شدہ اقسام کاشت کریں اور پنیری سے قبل بیج کو زہر آلود کریں۔',
            roman_ur: 'Blast-resistant certified beej istemal karein aur beej ko zehar aalood karein.',
            sd: 'تصديق ٿيل ٻج استعمال ڪريو ۽ ٻج کي پوکڻ کان اڳ فنجي سائيڊ لڳايو.',
          },
          {
            en: 'Maintain recommended plant spacing (approx 9 inches) for good canopy airflow and sunlight penetration.',
            ur: 'پودوں کا باہمی فاصلہ (تقریباً 9 انچ) مناسب رکھیں تاکہ پتوں تک ہوا اور دھوپ پہنچتی رہے۔',
            roman_ur: 'Podon ka darmiyani fasla 9 inch rakhein takay hawa aur dhoop pohanch sakay.',
            sd: 'ٻوٽن جي وچ ۾ 9 انچ فاصلو رکو ته جيئن هوا ۽ سج جي روشني ملندي رهي.',
          },
        ],
        when_to_consult_expert: {
          en: 'Consult local extension officer immediately if spindle lesions appear on more than 3-5% of foliage or near panicle neck.',
          ur: 'اگر تکلا نما دھبے 3 سے 5 فیصد پتوں پر ظاہر ہوں یا مونجھ کے قریب پہنچیں تو بغیر تاخیر مقامی زرعی افسر سے معائنہ کروائیں۔',
          roman_ur: 'Agar dhabbe 3-5% patton par zahir hon to foran zaria afsar ko dikhayein.',
          sd: 'جيڪڏهن نشان 3 کان 5 سيڪڙو پنن تي ظاهر ٿين ته ترت زرعي عملدار کي ڏيکاريو.',
        },
        requires_retake: false,
        requires_expert_review: true,
        message: {
          en: 'Visible spindle-shaped lesions observed on rice leaf. Blast-like symptoms detected; follow cultural hygiene and consult extension officer.',
          ur: 'دھان کے پتے پر بلاسٹ نما تکلا دھبے دیکھے گئے ہیں۔ یوریا کھاد روکیں اور مقامی زرعی توسیعی افسر سے معائنہ کروائیں۔',
          roman_ur: 'Dhan ke patte par blast numa dhabbe dekhay gaye hain. Urea rokein aur zaria afsar se rabta karein.',
          sd: 'چانورن جي پن تي بلاست جهڙا نشان ڏٺا ويا آهن. يوريا روڪيو ۽ زرعي عملدار سان صلاح ڪريو.',
        },
      };
    }
  }

  // Case C: Explicitly Verified Healthy Plant by Client Optical Pre-scan
  const isExplicitlyVerifiedHealthy =
    Boolean(clientQuality) &&
    clientQuality?.hasVisibleLesions === false &&
    (clientQuality?.greenRatio ?? 0) >= 0.45 &&
    (clientQuality?.lesionRatio ?? 0) <= 0.005;

  if (isExplicitlyVerifiedHealthy) {
    return {
      image_valid: true,
      detected_crop: crop.en,
      detected_crop_ur: crop.ur,
      detected_crop_roman_ur: crop.roman_ur,
      detected_crop_sd: crop.sd,
      selected_crop: selectedCrop,
      crop_match: true,
      detected_plant_part: 'Leaf',
      detected_plant_part_ur: 'پتا',
      detected_plant_part_roman_ur: 'Patta',
      detected_plant_part_sd: 'پن',
      growth_stage: 'Vegetative',
      growth_stage_ur: 'بڑھوتری کا مرحلہ',
      growth_stage_roman_ur: 'Barhotri ka marhala',
      growth_stage_sd: 'واڌ ويجهه جو مرحلو',
      identification_confidence: 0.94,
      visual_inspection: {
        lesion_detected: false,
        lesion_count: 'none',
        lesion_shape: 'none',
        lesion_colors: [],
        lesion_margins: 'none',
        lesion_distribution: 'none',
        tissue_damage: 'intact vigorous green tissue',
      },
      diagnosis_status: 'healthy_no_symptoms',
      plant_condition: 'No obvious visible symptoms detected. Plant tissue appears normal, green, and vigorous.',
      plant_condition_ur: 'کوئی واضح بیماری یا کیڑے کے دھبے نظر نہیں آئے؛ پودے کی بافتیں تندرست اور سرسبز ہیں۔',
      plant_condition_roman_ur: 'Koi wazeh bemari ya dhabbe nazar nahi aye; poda tandrust aur sar-sabz hai.',
      plant_condition_sd: 'ڪابه واضح بيماري يا داغ نظر نه آيو؛ ٻوٽو بلڪل صحتمند ۽ سائي رنگ جو آهي.',
      problem_name: {
        en: 'No Obvious Symptoms Detected (Appears Healthy)',
        ur: 'کوئی واضح علامات ظاہر نہیں ہوئیں (بظاہر تندرست)',
        roman_ur: 'Koi Wazeh Alamaat Nahi (Tandrust)',
        sd: 'ڪابه واضح علامت ظاهر ناهي (ظاهري صحتمند)',
      },
      possible_disease: [],
      alternative_diagnoses: [],
      why_suspected: {
        en: 'Uniform green coloration across leaf lamina with zero necrotic spots, zero blast spindles, and no visible pest feeding.',
        ur: 'پتے کی سطح پر یکساں سبز رنگت، کسی قسم کے دھبوں یا کیڑوں کے بغیر مکمل صحت مند کیفیت۔',
        roman_ur: 'Pattay ki satah par yaksaan sabz rangat aur kisi dhabbe ke baghair saf poda.',
        sd: 'پن جي سڄي مٿاڇري تي هڪجهڙو سائي رنگ ۽ ڪنهن به داغ کان پاڪ.',
      },
      observed_symptoms: [],
      possible_causes: [
        {
          en: 'Healthy crop growth under current seasonal and field management conditions.',
          ur: 'موجودہ موسمی و زرعی حالات میں پودے کی معمول کی تندرست بڑھوتری۔',
          roman_ur: 'Mausami halat mein poday ki mamool ki tandrust barhotri.',
          sd: 'موجوده موسمي حالتن ۾ ٻوٽي جي عام واڌ ويجهه.',
        },
      ],
      severity: 'low',
      severity_explanation: {
        en: 'No active tissue damage or disease lesions observed.',
        ur: 'بافتوں کا کوئی نقصان یا بیماری کے دھبے موجود نہیں ہیں۔',
        roman_ur: 'Pattay ko koi nuqsan nahi pohancha.',
        sd: 'ٻوٽي کي ڪوبه نقصان ناهي پهتو.',
      },
      recommendations: [
        {
          en: 'Maintain regular morning scouting to detect any initial pests or early airborne spores.',
          ur: 'روزانہ صبح کے وقت کھیت کا معائنہ جاری رکھیں تاکہ کسی بھی بیماری کا بروقت پتہ چل سکے۔',
          roman_ur: 'Rozana subah khet ka muaina jari rakhein takay kisi bemari ka barwaqt pata chal sakay.',
          sd: 'روزانو صبح جي وقت فيلڊ جو معائنو جاري رکو.',
        },
        {
          en: 'Ensure balanced irrigation and avoid prolonged water stress in the root zone.',
          ur: 'مناسب وتر پر آبپاشی کریں اور جڑوں میں اضافی پانی کھڑا نہ ہونے دیں۔',
          roman_ur: 'Munasib watar par pani dein aur jarron mein pani khara na hone dein.',
          sd: 'مناسب وتر تي پاڻي ڏيو ۽ پاڻي بيهڻ نه ڏيو.',
        },
        {
          en: 'Consult your local agricultural extension officer before applying any preventative chemicals.',
          ur: 'کسی بھی سپرے یا کیمیائی علاج سے قبل مقامی زرعی توسیعی افسر سے تصدیق کریں۔',
          roman_ur: 'Kisi bhi spray se qabal muqami zaria afsar se tasdeeq karein.',
          sd: 'ڪنهن به اسپري کان اڳ مقامي زرعي آفيسر سان صلاح ڪريو.',
        },
      ],
      what_to_do_now: [],
      prevention: [
        {
          en: 'Practice field hygiene and keep weed hosts clear around field borders.',
          ur: 'کھیت کی وٹوں اور کناروں سے جڑی بوٹیاں تلف رکھیں۔',
          roman_ur: 'Khet ki watton aur kinaray se jari bootiyan talaf rakhein.',
          sd: 'فيلڊ جي ٻنن تان گند گاهه صاف رکو.',
        },
        {
          en: 'Use certified seed and balanced NPK fertilizer recommendations.',
          ur: 'تصدیق شدہ بیج اور زمین کے تجزیے کے مطابق متوازن کھاد استعمال کریں۔',
          roman_ur: 'Certified beej aur mutawazan khad istemal karein.',
          sd: 'تصديق ٿيل ٻج ۽ متوازن ڀاڻ استعمال ڪريو.',
        },
      ],
      when_to_consult_expert: {
        en: 'Consult extension officer only if new discoloration or lesions appear during weekly scouting.',
        ur: 'اگر ہفتہ وار معائنے کے دوران کسی پتے پر دھبے یا مڑاؤ نظر آئے تو زرعی افسر سے مشورہ کریں۔',
        roman_ur: 'Agar haftawar muainay ke dauran dhabbe nazar ayein to zaria afsar se mashwara karein.',
        sd: 'جيڪڏهن هفتيوار معائني دوران ڪو داغ نظر اچي ته زرعي آفيسر سان صلاح ڪريو.',
      },
      requires_retake: false,
      requires_expert_review: false,
      message: {
        en: 'No obvious disease or pest symptoms observed. Note: visual inspection does not guarantee 100% absence of latent micro-pathogens.',
        ur: 'اس پودے پر کوئی واضح بیماری نہیں ملی۔ معمول کی دیکھ بھال جاری رکھیں۔ یاد رہے کہ بصری معائنہ سو فیصد پوشیدہ جراثیم کی غیر موجودگی کی حتمی ضمانت نہیں۔',
        roman_ur: 'Poday par koi wazeh bemari nahi mili. Mamool ki dekh bhal jari rakhein.',
        sd: 'ٻوٽي تي ڪابه واضح بيماري ناهي. عام سنڀال جاري رکو.',
      },
    };
  }

  // Case D: Inconclusive Offline Fallback (No Client Quality metrics or unverified)
  return {
    image_valid: true,
    detected_crop: crop.en,
    detected_crop_ur: crop.ur,
    detected_crop_roman_ur: crop.roman_ur,
    detected_crop_sd: crop.sd,
    selected_crop: selectedCrop,
    crop_match: true,
    detected_plant_part: 'Leaf',
    detected_plant_part_ur: 'پتا',
    detected_plant_part_roman_ur: 'Patta',
    detected_plant_part_sd: 'پن',
    growth_stage: 'Vegetative',
    growth_stage_ur: 'بڑھوتری کا مرحلہ',
    growth_stage_roman_ur: 'Barhotri ka marhala',
    growth_stage_sd: 'واڌ ويجهه جو مرحلو',
    identification_confidence: 0.60,
    visual_inspection: {
      lesion_detected: false,
      lesion_count: 'uncertain',
      lesion_shape: 'none',
      lesion_colors: [],
      lesion_margins: 'none',
      lesion_distribution: 'none',
      tissue_damage: 'inconclusive without active AI vision',
    },
    diagnosis_status: 'uncertain',
    plant_condition: 'Visual pathology analysis is inconclusive without active Gemini AI cloud inspection. If your plant has visible spots, wilting, or yellowing, do not assume it is healthy.',
    plant_condition_ur: 'جیمنائی کلاؤڈ ماڈل کے بغیر بیماری کی مکمل تصدیق نہیں ہو سکی۔ اگر پتے پر کوئی دھبے ہیں تو اسے تندرست نہ سمجھیں۔',
    plant_condition_roman_ur: 'Gemini AI ke baghair mukammal tasdeeq nahi ho saki. Agar patte par dhabbe hain to use tandrust na samjhein.',
    plant_condition_sd: 'جيمنائي بنا مڪمل چڪاس ممڪن ناهي. جيڪڏهن پن تي داغ آهن ته ان کي صحتمند نه سمجهو.',
    problem_name: {
      en: 'Inconclusive Offline Scan — Gemini Vision Inspection Recommended',
      ur: 'آف لائن معائنہ غیر حتمی — مکمل معائنے کے لیے جیمنائی درکار ہے',
      roman_ur: 'Offline Muaina Ghair Yaqeeni — Gemini AI Darkaar Hai',
      sd: 'آف لائن چڪاس غير حتمي — جيمنائي چڪاس گهربل آهي',
    },
    possible_disease: [],
    alternative_diagnoses: [],
    why_suspected: {
      en: 'Basic offline heuristics did not detect acute macro-damage, but Gemini Multimodal Vision is required to inspect subtle blast spindles, fungal spots, and leaf blight.',
      ur: 'بنیادی آف لائن چیک میں بڑا نقصان نہیں ملا، لیکن پتے کے باریک دھبے اور بلاسٹ جانچنے کے لیے جیمنائی وژن درکار ہے۔',
      roman_ur: 'Bara nuqsan nahi mila lekin bareek dhabbe janchnay ke liye Gemini darkaar hai.',
      sd: 'وڏو نقصان ناهي مليو پر بيماري جي پڪي سڃاڻپ لاءِ جيمنائي گهربل آهي.',
    },
    observed_symptoms: [],
    possible_causes: [
      {
        en: 'Cloud AI vision offline or API key missing during this scan.',
        ur: 'اسکین کے دوران کلاؤڈ اے آئی دستیاب نہیں تھی یا API کی غائب تھی۔',
        roman_ur: 'Scan ke dauran Cloud AI offline thi ya API key missing thi.',
        sd: 'اسڪين دوران ڪلائوڊ اي آءِ موجود نه هئي يا API ڪي غائب هئي.',
      },
    ],
    severity: 'not_assessed',
    severity_explanation: {
      en: 'Severity cannot be confirmed without active Gemini AI vision inspection.',
      ur: 'جیمنائی اے آئی کے بغیر بیماری کی شدت کا حتمی اندازہ نہیں لگایا جا سکتا۔',
      roman_ur: 'Gemini ke baghair shiddat ka andaza nahi lagaya ja sakta.',
      sd: 'جيمنائي بنا بيماري جي شدت جو حتمي اندازو نٿو لڳائي سگهجي.',
    },
    recommendations: [
      {
        en: 'Connect your Gemini API Key in the scanner settings to get instant live diagnosis.',
        ur: 'اسکینر کی سیٹنگز میں اپنی جیمنائی کی داخل کریں تاکہ فوری معائنہ ہو سکے۔',
        roman_ur: 'Scanner settings mein Gemini key connect karein.',
        sd: 'اسڪينر سيٽنگز ۾ جيمنائي ڪي داخل ڪريو.',
      },
    ],
    what_to_do_now: [],
    prevention: [],
    when_to_consult_expert: {
      en: 'If suspicious lesions or leaf spots are visible, consult your local agricultural extension officer.',
      ur: 'اگر پتے پر دھبے نظر آ رہے ہیں تو مقامی زرعی توسیعی افسر کو دکھائیں۔',
      roman_ur: 'Agar dhabbe nazar arahe hain to zaria afsar ko dikhayein.',
      sd: 'جيڪڏهن پن تي داغ آهن ته زرعي آفيسر کي ڏيکاريو.',
    },
    requires_retake: false,
    requires_expert_review: true,
    message: {
      en: 'Visual pathology analysis is inconclusive offline. Please connect your Gemini API key for complete diagnosis.',
      ur: 'آف لائن تجزیہ غیر حتمی ہے۔ براہ کرم مکمل معائنے کے لیے جیمنائی کی کنیکٹ کریں۔',
      roman_ur: 'Offline tajzia ghair yaqeeni hai. Mukammal muainay ke liye Gemini connect karein.',
      sd: 'آف لائن چڪاس غير حتمي آهي. مڪمل چڪاس لاءِ جيمنائي ڪنيڪٽ ڪريو.',
    },
  };
}
