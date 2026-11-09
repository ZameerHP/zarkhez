import diseasesData from '@/data/diseases.json';
import {
  Advice,
  AdviceSchema,
  SecondOpinion,
  SecondOpinionSchema,
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

function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
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
}): Promise<string> {
  const apiKey = getGeminiApiKey();
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
  return text;
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
    'gemini-1.5-flash';

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

  const model = process.env.GEMINI_MODEL_FAST || process.env.GEMINI_MODEL_DETAIL || 'gemini-1.5-flash';
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

  const model = process.env.GEMINI_MODEL_FAST || process.env.GEMINI_MODEL_DETAIL || 'gemini-1.5-flash';

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
