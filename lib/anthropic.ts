import Anthropic from '@anthropic-ai/sdk';
import diseasesData from '@/data/diseases.json';
import {
  Advice,
  AdviceSchema,
  SecondOpinion,
  SecondOpinionSchema,
} from './schemas';

/**
 * Server-side Anthropic integration (lib/anthropic.ts)
 * - Crafted for natural, human-sounding spoken Pakistani Urdu (خالص، شائستہ اور آسان زرعی اردو).
 * - Addresses the farmer respectfully by their Persona Name and Zarkhez ID when available.
 */

const adviceCache = new Map<string, Advice>();

const ADVICE_SYSTEM_PROMPT = `You are Zarkhez (زرخیز), a warm, deeply knowledgeable Pakistani agriculture advisor speaking to a farmer.
Rules:
- In Urdu ("ur"), write natural, fluent, respectful Pakistani agricultural Urdu (using proper terms like بوائی، وتر، شگوفے، گوبھ، تیلہ، کنگی، جھلساؤ، زرعی توسیعی افسر) that sounds warm and human when read aloud.
- Give low-risk, low-cost field hygiene and irrigation steps first.
- For chemical treatment, name only the product class or active ingredient type, never an exact hazardous dose. Remind the farmer to read the label and confirm with their local agriculture officer.
- If confidence is below 75% or you are unsure, set see_expert to true.
- Return ONLY valid JSON matching the schema. No markdown fences.`;

export const CHAT_SYSTEM_PROMPT = `آپ "زرخیز" (Zarkhez) ہیں — پاکستانی کسانوں کے مخلص، تجربہ کار اور شفیق زرعی دوست۔
آپ کا اندازِ گفتگو بالکل ایک شائستہ، ہمدرد اور ماہر پاکستانی زرعی مشیر جیسا ہونا چاہیے تاکہ جب آپ کا جواب آواز (Voice) میں سنا جائے تو وہ بالکل انسان جیسا فطری اور رواں لگے۔
اصول:
- اگر سوال اردو یا رومن اردو میں ہو تو جواب ہمیشہ خوبصورت، سلیس اور بامحاورہ اردو رسم الخط میں دیں۔
- کسان کو عزت کے ساتھ مخاطب کریں (اگر کسان کا نام مہیا ہو تو ان کا نام لے کر مخاطب کریں، مثلاً "محترم بھائی [نام]، السلام علیکم!")۔
- جواب مختصر، جامع اور بولنے کے انداز میں (100 سے 130 الفاظ کے اندر) رکھیں اور عملی تدابیر کو 1، 2، 3 نمبروں میں بیان کریں۔
- صرف تحریر سے پتے کی بیماری کی حتمی تشخیص نہ کریں بلکہ ایپ کے "پتا سکین کریں" (Scan Leaf) بٹن یا مقامی زرعی افسر سے معائنہ کروانے کا مشورہ دیں۔
- زرعی ادویات کی خطرناک مقدار ہرگز نہ بتائیں؛ ہمیشہ لیبل پڑھنے اور مقامی زرعی افسر سے مشورے کی تاکید کریں۔`;

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function getStaticFallbackAdvice(
  label: string,
  confidence: number
): Advice {
  const diseases = diseasesData as Record<string, Advice & { crop?: string }>;
  const entry = diseases[label] || diseases['not_a_plant'];
  const lowConf = confidence < 0.75 || label === 'not_a_plant';

  return {
    problem_name: entry.problem_name,
    severity: entry.severity,
    summary: entry.summary,
    steps: entry.steps,
    prevention: entry.prevention,
    see_expert: lowConf ? true : entry.see_expert,
    expert_reason:
      entry.expert_reason ||
      (lowConf
        ? {
            en: 'Confidence is below 75%. Please take a closer photo in natural daylight or show the plant to your local agriculture officer.',
            ur: 'تشخیص کا اعتماد 75 فیصد سے کم ہے۔ براہِ کرم دن کی قدرتی روشنی میں پتے کی قریب سے صاف تصویر لیں یا اپنے علاقے کے زرعی توسیعی افسر کو معائنہ کروائیں۔',
          }
        : undefined),
  };
}

export async function generateCropAdvice(
  label: string,
  confidence: number,
  crop: string
): Promise<{ advice: Advice; cached: boolean; source: 'ai' | 'fallback' }> {
  const cacheKey = `${crop}:${label}:${confidence >= 0.75 ? 'high' : 'low'}`;
  const cached = adviceCache.get(cacheKey);
  if (cached) {
    return { advice: cached, cached: true, source: 'ai' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const fallback = getStaticFallbackAdvice(label, confidence);
    adviceCache.set(cacheKey, fallback);
    return { advice: fallback, cached: false, source: 'fallback' };
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const userPrompt = `Crop: ${crop}
Detected label: ${label}
Model confidence: ${Math.round(confidence * 100)}%

Return ONLY valid JSON matching this TypeScript type:
{
  "problem_name": { "en": "string", "ur": "string" },
  "severity": "low" | "medium" | "high",
  "summary": { "en": "2 sentences max", "ur": "2 sentences max" },
  "steps": [{ "en": "string", "ur": "string" }],
  "prevention": [{ "en": "string", "ur": "string" }],
  "see_expert": boolean,
  "expert_reason": { "en": "string", "ur": "string" }
}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 800,
          temperature: 0.3,
          system: ADVICE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        },
        { signal: controller.signal }
      );

      const textBlock = response.content.find((b) => b.type === 'text');
      const rawText = textBlock && 'text' in textBlock ? textBlock.text : '';
      const cleaned = stripCodeFences(rawText);
      const parsed = JSON.parse(cleaned);
      const validated = AdviceSchema.parse(parsed);

      if (confidence < 0.75) {
        validated.see_expert = true;
      }

      adviceCache.set(cacheKey, validated);
      return { advice: validated, cached: false, source: 'ai' };
    } catch {
      // Retry once if attempt === 0
    } finally {
      clearTimeout(timeout);
    }
  }

  const fallback = getStaticFallbackAdvice(label, confidence);
  adviceCache.set(cacheKey, fallback);
  return { advice: fallback, cached: false, source: 'fallback' };
}

export async function verifyLeafImageWithVision(
  base64Image: string,
  crop: string,
  label = 'unclear'
): Promise<SecondOpinion> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
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

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');

  const prompt = `Look at this crop photo. The on-device model thinks it shows ${label} on ${crop} with low confidence. Say whether the photo is a clear plant leaf, what visible symptoms you see, and whether you agree. If the image is unclear or not a plant, say so. Return only the JSON schema provided:
{
  "is_clear_leaf": boolean,
  "agrees_with_model": boolean,
  "suggested_label": "string",
  "visible_symptoms": { "en": "string", "ur": "string" },
  "recommendation": { "en": "string", "ur": "string" }
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: 600,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: cleanBase64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      },
      { signal: controller.signal }
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    const rawText = textBlock && 'text' in textBlock ? textBlock.text : '';
    const parsed = JSON.parse(stripCodeFences(rawText));
    return SecondOpinionSchema.parse(parsed);
  } catch {
    return {
      is_clear_leaf: true,
      agrees_with_model: true,
      suggested_label: label,
      visible_symptoms: {
        en: 'Leaf surface shows mild discoloration; closer daylight inspection is advised.',
        ur: 'پتے کی سطح پر ہلکی رنگت کی تبدیلی نظر آ رہی ہے؛ دن کی روشنی میں قریب سے معائنہ کریں۔',
      },
      recommendation: {
        en: 'Confirm with your local agriculture extension officer before chemical treatment.',
        ur: 'کسی بھی کیمیائی دوا کے استعمال سے پہلے مقامی زرعی افسر سے تصدیق کریں۔',
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function generateFallbackChatReply(
  question: string,
  lang: 'en' | 'ur',
  context?: {
    farmerName?: string;
    farmerId?: string;
    crop?: string;
    region?: string;
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

  if (
    q.includes('منافع') ||
    q.includes('خرچ') ||
    q.includes('منڈی') ||
    q.includes('ریٹ') ||
    q.includes('profit') ||
    q.includes('price')
  ) {
    return isUrduQuestion
      ? `${nameGreetingUr}، کھیتی باڑی میں آمدن اور اخراجات کا پورا حساب رکھنا کامیاب کسان کی نشانی ہے۔\n1۔ آپ زرخیز کے "منافع کیلکولیٹر" میں اپنے بیج، کھاد، پانی اور مزدوری کا خرچ درج کر کے فی ایکڑ متوقع منافع دیکھ سکتے ہیں۔\n2۔ اپنے روزمرہ کے اخراجات اور فصل کی فروخت کو "فارم ڈائری (کھاتہ)" میں درج کریں تاکہ ہر مہینے کی بچت آپ کے سامنے رہے۔`
      : `${nameGreetingEn}, tracking every input cost helps maximize your season's return.\n1. Use the Profit Calculator and its What-If price slider to estimate net income per acre.\n2. Log your daily seed, fertilizer, and irrigation expenses in the Farm Diary.`;
  }

  return isUrduQuestion
    ? `وعلیکم السلام ${nameGreetingUr}! میں زرخیز ہوں، آپ کی کھیتی کا مخلص دوست${
        context?.farmerId ? ` (آپ کا کسان آئی ڈی: ${context.farmerId})` : ''
      }۔\n1۔ اگر کسی فصل کے پتے پر بیماری یا کیڑے کا شک ہو تو "پتا سکین کریں" سے تصویر بنائیں۔\n2۔ پانی اور کھاد کے شیڈول کے لیے "فصل کیلنڈر" اور "کھاد کیلکولیٹر" دیکھیں۔\n3۔ آپ اس وقت کس فصل (گندم، دھان، کپاس، گنا، مکئی یا ٹماٹر) کے بارے میں مشورہ چاہتے ہیں؟ بے جھجھک بول کر یا لکھ کر بتائیں!`
    : `Wa Alaikum Assalam ${nameGreetingEn}! I am Zarkhez, your personal farming companion${
        context?.farmerId ? ` (Farmer ID: ${context.farmerId})` : ''
      }.\n1. Use "Scan Leaf" to inspect any diseased crop leaf.\n2. Use "Crop Calendar", "Fertilizer Calculator", and "Profit Calculator" to plan your season.\n3. Which crop can I help you with today (wheat, rice, cotton, sugarcane, maize, or tomato)?`;
}
