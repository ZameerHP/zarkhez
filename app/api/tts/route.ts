import { NextRequest, NextResponse } from 'next/server';

/**
 * Neural Human-Like Urdu & English Text-to-Speech API Route (/api/tts)
 * Supports:
 * 1. Microsoft Azure Speech (ur-PK-UzmaNeural / ur-PK-AsadNeural) when key is configured
 * 2. High-speed parallel Google Neural/GTX fallback (ultra-reliable, 0 configuration, works everywhere)
 */

const ttsMemoryCache = new Map<string, { buffer: Uint8Array; timestamp: number }>();

const PHRASE_PHONETIC_MAP: Array<[RegExp, string]> = [
  [/assalam\s*[-o\s]*alaikum/gi, 'السلام علیکم'],
  [/walaikum\s*[-o\s]*assalam/gi, 'وعلیکم السلام'],
  [/alhamdulillah/gi, 'الحمدللہ'],
  [/inshallah|insha\s*allah/gi, 'انشاءاللہ'],
  [/mashallah|masha\s*allah/gi, 'ماشاءاللہ'],
  [/allah\s+barkat\s+de/gi, 'اللہ برکت دے'],
  [/allah\s+hafiz/gi, 'اللہ حافظ'],
  [/khuda\s+hafiz/gi, 'خدا حافظ'],
  [/jazakallah/gi, 'جزاک اللہ'],
  [/subhanallah/gi, 'سبحان اللہ'],
];

const ROMAN_TO_URDU_WORDS: Record<string, string> = {
  // Agricultural & Crops
  gandum: 'گندم',
  dhan: 'دھان',
  chawal: 'چاول',
  kapas: 'کپاس',
  kamad: 'کماد',
  ganna: 'گنا',
  makai: 'مکئی',
  tamatar: 'ٹماٹر',
  aloo: 'آلو',
  mirch: 'مرچ',
  aam: 'آم',
  kinnow: 'کنو',
  malta: 'مالٹا',
  pyaz: 'پیاز',
  fasal: 'فصل',
  faslon: 'فصلوں',
  khet: 'کھیت',
  kheton: 'کھیتوں',
  pani: 'پانی',
  aabpashi: 'آبپاشی',
  khad: 'کھاد',
  khadon: 'کھادوں',
  bori: 'بوری',
  boriyan: 'بوریاں',
  beej: 'بیج',
  bijai: 'بجائی',
  patta: 'پتا',
  patte: 'پتے',
  paton: 'پتوں',
  jar: 'جڑ',
  jarein: 'جڑیں',
  tana: 'تنا',
  phool: 'پھول',
  phal: 'پھل',
  sitta: 'سٹہ',
  paidawar: 'پیداوار',
  munafa: 'منافع',
  kharcha: 'خرچہ',
  bimari: 'بیماری',
  bimariyan: 'بیماریاں',
  keera: 'کیڑا',
  keeray: 'کیڑے',
  sundi: 'سنڈی',
  makhi: 'مکھی',
  teli: 'تیلا',
  phaphondi: 'پھپھوندی',
  jhallao: 'جھلساؤ',
  kangi: 'کنگی',
  peela: 'پیلا',
  peeli: 'پیلی',
  peelay: 'پیلے',
  sukad: 'سکڑ',
  sukr: 'سکڑ',
  dhabba: 'دھبہ',
  dhabbe: 'دھبے',
  // Conversational
  bhai: 'بھائی',
  bhaiya: 'بھائی',
  sahib: 'صاحب',
  sahab: 'صاحب',
  mohtaram: 'محترم',
  kisan: 'کسان',
  dost: 'دوست',
  aap: 'آپ',
  ap: 'آپ',
  aapko: 'آپ کو',
  apko: 'آپ کو',
  aapka: 'آپ کا',
  apka: 'آپ کا',
  aapki: 'آپ کی',
  apki: 'آپ کی',
  aapke: 'آپ کے',
  apke: 'آپ کے',
  main: 'میں',
  mein: 'میں',
  mera: 'میرا',
  meri: 'میری',
  mere: 'میرے',
  hum: 'ہم',
  hamara: 'ہمارا',
  hamari: 'ہماری',
  hamare: 'ہمارے',
  yeh: 'یہ',
  ye: 'یہ',
  woh: 'وہ',
  wo: 'وہ',
  hai: 'ہے',
  hain: 'ہیں',
  tha: 'تھا',
  thi: 'تھی',
  thay: 'تھے',
  the: 'تھے',
  hoga: 'ہوگا',
  hogi: 'ہوگی',
  honge: 'ہوں گے',
  aur: 'اور',
  ya: 'یا',
  lekin: 'لیکن',
  magar: 'مگر',
  bhi: 'بھی',
  to: 'تو',
  toh: 'تو',
  hi: 'ہی',
  kya: 'کیا',
  kyun: 'کیوں',
  kyon: 'کیوں',
  kab: 'کب',
  kahan: 'کہاں',
  kaise: 'کیسے',
  kese: 'کیسے',
  kitna: 'کتنا',
  kitni: 'کتنی',
  kitne: 'کتنے',
  ka: 'کا',
  ki: 'کی',
  ke: 'کے',
  ko: 'کو',
  se: 'سے',
  par: 'پر',
  pe: 'پر',
  tak: 'تک',
  ne: 'نے',
  karna: 'کرنا',
  karein: 'کریں',
  karen: 'کریں',
  karo: 'کرو',
  karta: 'کرتا',
  karti: 'کرتی',
  karte: 'کرتے',
  dein: 'دیں',
  den: 'دیں',
  do: 'دو',
  dena: 'دینا',
  lein: 'لیں',
  len: 'لیں',
  lena: 'لینا',
  lagayein: 'لگائیں',
  lagaen: 'لگائیں',
  lagana: 'لگانا',
  batayein: 'بتائیں',
  bataen: 'بتائیں',
  batana: 'بتانا',
  rakhein: 'رکھیں',
  rakhen: 'رکھیں',
  rakhna: 'رکھنا',
  jayein: 'جائیں',
  jaen: 'جائیں',
  jana: 'جانا',
  aayein: 'آئیں',
  aaen: 'آئیں',
  aana: 'آنا',
  dekhein: 'دیکھیں',
  dekhna: 'دیکھنا',
  mat: 'مت',
  na: 'نہ',
  nahi: 'نہیں',
  nahin: 'نہیں',
  sirf: 'صرف',
  zyada: 'زیادہ',
  ziyada: 'زیادہ',
  kam: 'کم',
  bohat: 'بہت',
  bahut: 'بہت',
  thora: 'تھوڑا',
  pehle: 'پہلے',
  pehla: 'پہلا',
  pehli: 'پہلی',
  doosra: 'دوسرا',
  doosri: 'دوسری',
  teesra: 'تیسرا',
  teesri: 'تیسری',
  baad: 'بعد',
  sath: 'ساتھ',
  saath: 'ساتھ',
  theek: 'ٹھیک',
  acha: 'اچھا',
  achha: 'اچھا',
  achi: 'اچھی',
  achay: 'اچھے',
  ache: 'اچھے',
  zaroor: 'ضرور',
  zaroori: 'ضروری',
  bilkul: 'بالکل',
  pareshan: 'پریشان',
  shukriya: 'شکریہ',
  hawa: 'ہوا',
  barish: 'بارش',
  dhoop: 'دھوپ',
  mausam: 'موسم',
  sardi: 'سردی',
  garmi: 'گرمی',
  nami: 'نمی',
  subah: 'صبح',
  shaam: 'شام',
  sham: 'شام',
  dopahar: 'دوپہر',
  raat: 'رات',
  waqt: 'وقت',
  din: 'دن',
  hafte: 'ہفتے',
  hafta: 'ہفتہ',
  mahina: 'مہینہ',
  saal: 'سال',
  ek: 'ایک',
  aik: 'ایک',
  teen: 'تین',
  char: 'چار',
  paanch: 'پانچ',
  che: 'چھ',
  chay: 'چھ',
  saat: 'سات',
  aath: 'آٹھ',
  nau: 'نو',
  das: 'دس',
  bees: 'بیس',
  pachees: 'پچیس',
  tees: 'تیس',
  chalees: 'چالیس',
  pachaas: 'پچاس',
};

function romanUrduToSpokenUrduScript(text: string): string {
  // If text already contains significant Urdu script, return directly
  if (/[\u0600-\u06FF]{4,}/.test(text)) {
    return text;
  }

  let out = text;
  for (const [rgx, rep] of PHRASE_PHONETIC_MAP) {
    out = out.replace(rgx, rep);
  }

  return out
    .split(/(\b[\w'-]+\b)/)
    .map((token) => {
      const lower = token.toLowerCase();
      return ROMAN_TO_URDU_WORDS[lower] || token;
    })
    .join('');
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanTextForSpeech(text: string, lang: 'ur' | 'en'): string {
  let cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_~`>|[\]()•]/g, ' ')
    .replace(/\bRs\.\s*/gi, lang === 'ur' ? 'روپے ' : 'Rupees ')
    .replace(/\bPKR\b/gi, lang === 'ur' ? 'روپے ' : 'Rupees ')
    .replace(/(\d+)\s*%/g, '$1 percent ')
    .replace(/(?:^|\n)\s*(\d+)\.\s+/g, lang === 'ur' ? ' نمبر $1: ' : ' Step $1: ')
    .replace(/\s+/g, ' ')
    .trim();

  if (lang === 'ur') {
    cleaned = romanUrduToSpokenUrduScript(cleaned);
  }
  return cleaned;
}

function splitIntoSpeakableChunks(
  text: string,
  lang: 'ur' | 'en',
  maxLen = 120
): string[] {
  const cleaned = cleanTextForSpeech(text, lang);
  if (!cleaned) return [];

  // Split by sentence delimiters
  const sentences = cleaned.split(/(?<=[۔.!?،,\n])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length <= maxLen) {
      current = (current + ' ' + sentence).trim();
    } else {
      if (current) chunks.push(current);
      if (sentence.length <= maxLen) {
        current = sentence.trim();
      } else {
        const words = sentence.split(' ');
        let temp = '';
        for (const w of words) {
          if ((temp + ' ' + w).trim().length <= maxLen) {
            temp = (temp + ' ' + w).trim();
          } else {
            if (temp) chunks.push(temp);
            temp = w;
          }
        }
        current = temp;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get('text') || '').trim().slice(0, 900);
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ur';
  const voice = searchParams.get('voice') || (lang === 'ur' ? 'ur-PK-UzmaNeural' : 'en-US-JennyNeural');

  if (!text) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const cacheKey = `${lang}:${voice}:${text}`;
  const cached = ttsMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 86400_000) {
    return new Response(Buffer.from(cached.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  }

  // 1. Try Azure Speech Service if key is provided
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (azureKey) {
    try {
      const azureUrl = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version='1.0' xml:lang='${lang === 'ur' ? 'ur-PK' : 'en-US'}'>
        <voice xml:lang='${lang === 'ur' ? 'ur-PK' : 'en-US'}' name='${voice}'>
          ${escapeXml(cleanTextForSpeech(text, lang))}
        </voice>
      </speak>`;

      const res = await fetch(azureUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'Zarkhez-TTS',
        },
        body: ssml,
      });

      if (res.ok) {
        const audioBuf = await res.arrayBuffer();
        const uint8 = new Uint8Array(audioBuf);
        ttsMemoryCache.set(cacheKey, { buffer: uint8, timestamp: Date.now() });

        return new Response(Buffer.from(uint8), {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    } catch (azureErr) {
      console.warn('[Azure TTS] Fallback to fast parallel engine:', azureErr);
    }
  }

  // 2. High-speed Parallel Google Voice Stream (Fast, Warm, Ultra-Reliable)
  const chunks = splitIntoSpeakableChunks(text, lang, 100);
  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Empty text' }, { status: 400 });
  }

  try {
    const chunkPromises = chunks.map(async (chunk) => {
      const ttsUrl = new URL('https://translate.google.com/translate_tts');
      ttsUrl.searchParams.set('ie', 'UTF-8');
      ttsUrl.searchParams.set('tl', lang);
      ttsUrl.searchParams.set('client', 'gtx');
      ttsUrl.searchParams.set('q', chunk);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);

      try {
        const res = await fetch(ttsUrl.toString(), {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
            Accept: '*/*',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 64) {
            return buf;
          }
        }
      } catch {
        // ignore chunk error
      } finally {
        clearTimeout(timeout);
      }
      return null;
    });

    const buffers = (await Promise.all(chunkPromises)).filter(
      (b): b is ArrayBuffer => b !== null
    );

    if (buffers.length === 0) {
      return NextResponse.json(
        { error: 'TTS upstream unavailable' },
        { status: 502 }
      );
    }

    const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of buffers) {
      combined.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }

    if (ttsMemoryCache.size > 250) {
      ttsMemoryCache.clear();
    }
    ttsMemoryCache.set(cacheKey, { buffer: combined, timestamp: Date.now() });

    return new Response(Buffer.from(combined), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (err) {
    console.error('[TTS API error]:', err);
    return NextResponse.json(
      { error: 'Failed to synthesize speech' },
      { status: 502 }
    );
  }
}
