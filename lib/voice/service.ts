import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  TTSRequest,
  TTSResult,
  VoiceGender,
  VoiceLang,
  VoiceProviderId,
} from './types';
import {
  isProviderAllowedForLanguage,
  resolveExplicitLocale,
} from './script-guard';
import { toSpokenText } from './spoken-normalizer';
import {
  cleanTechnicalMetadataForSpeech,
  looksLikeRomanUrdu,
  transliterateCommonRomanUrduToUrdu,
} from './speech-prep';
import { buildVoiceSsml, resolveSpeakingRate } from './ssml-builder';
import { loadHotPronunciationLexicon, readServerEnv } from './server-lexicon';
import { redactSecrets } from '../error-sanitizer';
import { recordDiagnosticEvent, recordDiagnosticSuccess } from '../server/diagnostics-store';

interface MemoryAudioCacheEntry {
  buffer: Uint8Array;
  contentType: 'audio/wav' | 'audio/mpeg';
  provider: VoiceProviderId;
  voiceLabel: string;
  audioId: string;
  createdAt: number;
}

const MAX_MEMORY_CACHE_ENTRIES = 350;
const MEMORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ttsMemoryCache = new Map<string, MemoryAudioCacheEntry>();

export interface VoiceProfileSpec {
  id: string;
  label: string;
  gender: VoiceGender;
  geminiVoice: string;
  azureVoice?: string;
  elevenLabsDefaultVoice: string;
  toneInstruction: string;
}

export const VOICE_PROFILES: Record<VoiceLang, Record<VoiceGender, VoiceProfileSpec>> = {
  ur: {
    female: {
      id: 'ur-pk-female-calm',
      label: 'عظمیٰ — وقار اور اپنائیت بھرا لہجہ',
      gender: 'female',
      geminiVoice: 'Aoede',
      azureVoice: 'ur-PK-UzmaNeural',
      elevenLabsDefaultVoice: 'EXAVITQu4vr4xnSDxMaL',
      toneInstruction:
        'Speak in warm, smooth, conversational Pakistani Urdu (ur-PK) like a trusted agricultural advisor talking gently face-to-face with a farmer. Flow naturally across commas and phrases without choppy pauses or newsreader stiffness.',
    },
    male: {
      id: 'ur-pk-male-calm',
      label: 'اسد — پُرسکون دیہی مشیر لہجہ',
      gender: 'male',
      geminiVoice: 'Orus',
      azureVoice: 'ur-PK-AsadNeural',
      elevenLabsDefaultVoice: 'pNInz6obpgDQGcFmaJgB',
      toneInstruction:
        'Speak in warm, calm, conversational Pakistani Urdu (ur-PK) male voice like an experienced local field officer speaking smoothly to a farmer brother.',
    },
  },
  sd: {
    female: {
      id: 'sd-pk-female-calm',
      label: 'سسئي — مٺو ۽ واضح سنڌي لهجو',
      gender: 'female',
      geminiVoice: 'Aoede',
      // Azure Neural does NOT support Sindhi (sd-PK); explicitly omitted
      elevenLabsDefaultVoice: 'EXAVITQu4vr4xnSDxMaL',
      toneInstruction:
        'Speak strictly in authentic Pakistani Sindhi (sd-PK, Sindh province accent). Preserve Sindhi implosive and aspirated sounds (ڀ ٻ ڄ ڃ ڇ ڏ ڊ ڌ ڍ ڙ ڦ ڪ ڳ ڱ ڻ ٿ ٺ ٽ) faithfully. Warm, mature, calm rural advisor tone.',
    },
    male: {
      id: 'sd-pk-male-calm',
      label: 'سچل — پُرسڪون سنڌي زرعي لهجو',
      gender: 'male',
      geminiVoice: 'Charon',
      elevenLabsDefaultVoice: 'pNInz6obpgDQGcFmaJgB',
      toneInstruction:
        'Speak strictly in authentic Pakistani Sindhi (sd-PK, Sindh province accent) in a calm, mature male farmer-advisor tone. Articulate all Sindhi consonants clearly without Urdu or Hindi shift.',
    },
  },
  en: {
    female: {
      id: 'en-pk-female-calm',
      label: 'Ava (Natural Agricultural Advisor)',
      gender: 'female',
      geminiVoice: 'Aoede',
      azureVoice: 'en-US-AvaMultilingualNeural',
      elevenLabsDefaultVoice: 'EXAVITQu4vr4xnSDxMaL',
      toneInstruction:
        'Speak in smooth, warm, natural conversational English like a friendly experienced agricultural advisor talking easily with a farmer.',
    },
    male: {
      id: 'en-pk-male-calm',
      label: 'Andrew (Natural Agricultural Advisor)',
      gender: 'male',
      geminiVoice: 'Orus',
      azureVoice: 'en-US-AndrewMultilingualNeural',
      elevenLabsDefaultVoice: 'pNInz6obpgDQGcFmaJgB',
      toneInstruction:
        'Speak in calm, reassuring, natural English male voice for farmers.',
    },
  },
};

export function getProviderPriorityChain(
  lang: VoiceLang,
  preferProvider?: VoiceProviderId
): VoiceProviderId[] {
  const baseChain: VoiceProviderId[] =
    lang === 'sd'
      ? ['elevenlabs-v3', 'gemini-tts', 'mms-sindhi', 'google-cloud-tts']
      : ['azure-neural', 'gemini-tts', 'elevenlabs-v3', 'google-cloud-tts'];

  const filtered = baseChain.filter((p) => isProviderAllowedForLanguage(p, lang));
  if (preferProvider && isProviderAllowedForLanguage(preferProvider, lang)) {
    return Array.from(new Set([preferProvider, ...filtered]));
  }
  return filtered;
}

export function buildAudioCacheKey(params: {
  spokenText: string;
  lang: VoiceLang;
  gender: VoiceGender;
  speedRate: number;
  preferProvider?: VoiceProviderId;
}): string {
  const voiceSig =
    VOICE_PROFILES[params.lang]?.[params.gender]?.geminiVoice ||
    VOICE_PROFILES[params.lang]?.[params.gender]?.azureVoice ||
    'default';
  const payload = [
    'v4',
    params.lang,
    params.gender,
    voiceSig,
    params.speedRate.toFixed(2),
    params.preferProvider || 'auto',
    params.spokenText,
  ].join('|');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 24);
}

function wrapPcmAsWav(pcmBytes: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBytes.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBytes.byteLength, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcmBytes)]));
}

function lookupNativeRecording(
  lang: VoiceLang,
  gender: VoiceGender,
  clipId?: string
): { buffer: Uint8Array; contentType: 'audio/wav' | 'audio/mpeg' } | null {
  if (!clipId || !/^[a-z0-9_-]{2,64}$/i.test(clipId)) return null;
  const nativeDir = path.resolve(process.cwd(), 'public', 'audio', 'native', lang, gender);
  for (const [ext, mime] of [
    ['mp3', 'audio/mpeg'],
    ['wav', 'audio/wav'],
  ] as const) {
    const filePath = path.join(nativeDir, `${clipId}.${ext}`);
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      if (buf.byteLength > 128) {
        return { buffer: new Uint8Array(buf), contentType: mime };
      }
    }
  }
  return null;
}

function readDiskCache(
  cacheHash: string
): { buffer: Uint8Array; contentType: 'audio/wav' | 'audio/mpeg' } | null {
  try {
    const cacheDir = path.resolve(process.cwd(), 'public', 'audio', 'cache');
    for (const [ext, mime] of [
      ['wav', 'audio/wav'],
      ['mp3', 'audio/mpeg'],
    ] as const) {
      const filePath = path.join(cacheDir, `${cacheHash}.${ext}`);
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        if (buf.byteLength > 128) {
          return { buffer: new Uint8Array(buf), contentType: mime };
        }
      }
    }
  } catch {
    // ignore read failure cleanly
  }
  return null;
}

function writeDiskCache(
  cacheHash: string,
  buffer: Uint8Array,
  contentType: 'audio/wav' | 'audio/mpeg'
): void {
  try {
    const cacheDir = path.resolve(process.cwd(), 'public', 'audio', 'cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const ext = contentType === 'audio/mpeg' ? 'mp3' : 'wav';
    const targetPath = path.join(cacheDir, `${cacheHash}.${ext}`);
    fs.writeFileSync(targetPath, Buffer.from(buffer));
  } catch {
    // Read-only production filesystems (e.g. serverless runtime) rely on in-memory + HTTP cache cleanly
  }
}

function buildGeminiTtsContentText(params: {
  spokenText: string;
  lang: VoiceLang;
  model: string;
}): string {
  // Compact inline [warm] tag works reliably across 3.8-flash-tts & 3.1-flash-tts-preview
  // without adding 20s latency or leaking instruction text aloud; keep Sindhi and lite pure.
  if (
    params.lang === 'sd' ||
    (params.model !== 'gemini-3.8-flash-tts' && params.model !== 'gemini-3.1-flash-tts-preview')
  ) {
    return params.spokenText;
  }

  return `[warm] ${params.spokenText}`;
}

async function synthesizeWithGeminiTts(params: {
  spokenText: string;
  lang: VoiceLang;
  profile: VoiceProfileSpec;
  speedRate: number;
}): Promise<{ buffer: Uint8Array; contentType: 'audio/wav' } | null> {
  const apiKey = readServerEnv(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  if (!apiKey) return null;

  const ttsInputText = params.spokenText;

  // Prefer reliable fast gemini-3.8-flash-tts & lite-tts ahead of quota-limited preview models,
  // avoiding gemini-2.5-flash-preview-tts which frequently returns finishReason:OTHER with empty audio on ur-PK.
  const modelsToTry =
    params.lang === 'sd'
      ? ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']
      : [
          'gemini-3.8-flash-tts',
          'gemini-3.8-flash-lite-tts',
          'gemini-3.1-flash-tts-preview',
        ];

  const geminiLangCode =
    params.lang === 'ur' ? 'ur-PK' : params.lang === 'en' ? 'en-US' : undefined;

  for (const model of modelsToTry) {
    const promptText = buildGeminiTtsContentText({
      spokenText: ttsInputText,
      lang: params.lang,
      model,
    });
    for (const includeLangCode of geminiLangCode ? [true, false] : [false]) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  ...(includeLangCode && geminiLangCode ? { languageCode: geminiLangCode } : {}),
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: params.profile.geminiVoice },
                  },
                },
              },
            }),
            signal: AbortSignal.timeout(22000),
          }
        );

        if (!res.ok) {
          if (res.status === 400 && includeLangCode) continue;
          if (res.status === 401 || res.status === 403) return null;
          break;
        }

        const data = await res.json();
        const parts = (data?.candidates?.[0]?.content?.parts || []) as Array<{
          inlineData?: { mimeType?: string; data?: string };
        }>;
        const audioPart = parts.find((p) => Boolean(p.inlineData?.data))?.inlineData;
        if (!audioPart?.data) break;

        const rawBytes = new Uint8Array(Buffer.from(audioPart.data, 'base64'));
        const mime = (audioPart.mimeType || '').toLowerCase();
        if (mime.includes('wav') || (rawBytes[0] === 0x52 && rawBytes[1] === 0x49)) {
          return { buffer: rawBytes, contentType: 'audio/wav' };
        }
        // PCM audio/L16;rate=24000 -> wrap as standard playable WAV
        const rateMatch = mime.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
        return { buffer: wrapPcmAsWav(rawBytes, sampleRate, 1), contentType: 'audio/wav' };
      } catch {
        break;
      }
    }
  }
  return null;
}

async function synthesizeWithElevenLabs(params: {
  spokenText: string;
  lang: VoiceLang;
  profile: VoiceProfileSpec;
  speedRate: number;
}): Promise<{ buffer: Uint8Array; contentType: 'audio/mpeg' } | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;

  const envVoiceKey = `ELEVENLABS_VOICE_${params.lang.toUpperCase()}_${params.profile.gender.toUpperCase()}`;
  const voiceId = process.env[envVoiceKey]?.trim() || params.profile.elevenLabsDefaultVoice;

  const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const attempts: Array<{ includeSpeed: boolean }> =
    params.speedRate !== 1.0 ? [{ includeSpeed: true }, { includeSpeed: false }] : [{ includeSpeed: false }];

  for (const opt of attempts) {
    try {
      const bodyPayload: Record<string, unknown> = {
        text: params.spokenText,
        model_id: 'eleven_v3',
        language_code: params.lang,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          use_speaker_boost: true,
        },
        ...(opt.includeSpeed ? { speed: Math.min(1.15, Math.max(0.7, params.speedRate)) } : {}),
      };

      const res = await fetch(elevenUrl, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        if ((res.status === 400 || res.status === 422) && opt.includeSpeed) continue;
        return null;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 128) return null;
      return { buffer: new Uint8Array(buf), contentType: 'audio/mpeg' };
    } catch {
      return null;
    }
  }
  return null;
}

const AZURE_VOICE_CATALOG_TTL_MS = 60 * 60 * 1000;
const azureVoiceCatalogCache = new Map<string, { voices: Set<string>; fetchedAt: number }>();

async function resolveVerifiedAzureVoice(params: {
  azureKey: string;
  azureRegion: string;
  lang: VoiceLang;
  preferredVoice: string;
}): Promise<string> {
  if (params.lang === 'sd') return params.preferredVoice;

  const candidates =
    params.lang === 'ur'
      ? [params.preferredVoice, 'ur-PK-UzmaNeural', 'ur-PK-AsadNeural']
      : [
          params.preferredVoice,
          'en-US-AvaMultilingualNeural',
          'en-US-AndrewMultilingualNeural',
          'en-US-JennyNeural',
        ];

  const cacheKey = `${params.azureRegion}:${params.azureKey.slice(-6)}`;
  let catalog = azureVoiceCatalogCache.get(cacheKey);
  if (!catalog || Date.now() - catalog.fetchedAt > AZURE_VOICE_CATALOG_TTL_MS) {
    try {
      const res = await fetch(
        `https://${params.azureRegion}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
        {
          headers: { 'Ocp-Apim-Subscription-Key': params.azureKey },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (res.ok) {
        const list = (await res.json()) as Array<{ ShortName?: string }>;
        if (Array.isArray(list) && list.length > 0) {
          const names = new Set(list.map((v) => v.ShortName || '').filter(Boolean));
          catalog = { voices: names, fetchedAt: Date.now() };
          azureVoiceCatalogCache.set(cacheKey, catalog);
        }
      }
    } catch {
      // Offline / mock fetch environments proceed cleanly with preferred canonical neural voice
    }
  }

  if (catalog && catalog.voices.size > 0) {
    for (const candidate of candidates) {
      if (catalog.voices.has(candidate)) return candidate;
    }
  }
  return params.preferredVoice;
}

async function convertRomanUrduIfNeeded(text: string, lang: VoiceLang): Promise<string> {
  const cleaned = cleanTechnicalMetadataForSpeech(text);
  if (lang !== 'ur' || !looksLikeRomanUrdu(cleaned)) return cleaned;

  const apiKey = readServerEnv(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  if (apiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `Convert this Roman Urdu farming text cleanly into natural Pakistani Urdu (Nastaliq script). Keep scientific names, crop varieties, chemical active ingredients (e.g. NPK, DAP, Tricyclazole, Alternaria solani), and numbers accurate without translating meanings away. Output ONLY pure Urdu script:\n\n${cleaned}`,
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
          }),
          signal: AbortSignal.timeout(6000),
        }
      );
      if (res.ok) {
        const j = await res.json();
        const out = String(j?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (out && /[\u0600-\u06FF]/.test(out) && !looksLikeRomanUrdu(out)) {
          return cleanTechnicalMetadataForSpeech(out);
        }
      }
    } catch {
      // Fallback cleanly to deterministic phrase mapper
    }
  }

  return transliterateCommonRomanUrduToUrdu(cleaned);
}

async function synthesizeWithAzureNeural(params: {
  spokenText: string;
  lang: VoiceLang;
  profile: VoiceProfileSpec;
  speedRate: number;
}): Promise<{ buffer: Uint8Array; contentType: 'audio/mpeg' } | null> {
  // Explicitly disallow Azure for Sindhi (sd-PK) as Azure has zero Sindhi TTS voices
  if (params.lang === 'sd' || !params.profile.azureVoice) return null;

  const azureKey = readServerEnv(['AZURE_SPEECH_KEY', 'AZURE_TTS_KEY']);
  if (!azureKey) return null;
  const azureRegion = readServerEnv(['AZURE_SPEECH_REGION', 'AZURE_TTS_REGION']) || 'eastus';

  const voiceName = await resolveVerifiedAzureVoice({
    azureKey,
    azureRegion,
    lang: params.lang,
    preferredVoice: params.profile.azureVoice,
  });

  const lexiconEntries = loadHotPronunciationLexicon();
  const preferredStyle: 'friendly' | 'none' =
    params.lang === 'en' && voiceName.includes('AvaMultilingual') ? 'friendly' : 'none';

  const sendSsmlRequest = async (style: 'friendly' | 'none') => {
    const ssml = buildVoiceSsml({
      text: params.spokenText,
      lang: params.lang,
      voiceName,
      speedRate: params.speedRate,
      lexiconEntries,
      style,
    });
    return fetch(
      `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
          'User-Agent': 'Zarkhez-VoiceService',
        },
        body: ssml,
        signal: AbortSignal.timeout(12000),
      }
    );
  };

  try {
    let res = await sendSsmlRequest(preferredStyle);
    // Graceful fallback if the Azure voice resource rejects expressive style tags
    if (!res.ok && preferredStyle !== 'none' && res.status === 400) {
      res = await sendSsmlRequest('none');
    }
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 128) return null;
    return { buffer: new Uint8Array(buf), contentType: 'audio/mpeg' };
  } catch {
    return null;
  }
}

async function synthesizeWithGoogleCloudTts(params: {
  spokenText: string;
  lang: VoiceLang;
  profile: VoiceProfileSpec;
  speedRate: number;
}): Promise<{ buffer: Uint8Array; contentType: 'audio/mpeg' } | null> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY?.trim();
  if (!apiKey) return null;

  const languageCode =
    params.lang === 'sd' ? 'sd-IN' : params.lang === 'ur' ? 'ur-PK' : 'en-US';
  const ssmlGender = params.profile.gender === 'male' ? 'MALE' : 'FEMALE';

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: params.spokenText },
          voice: { languageCode, ssmlGender },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: params.speedRate,
          },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) return null;
    return {
      buffer: new Uint8Array(Buffer.from(data.audioContent, 'base64')),
      contentType: 'audio/mpeg',
    };
  } catch {
    return null;
  }
}

async function synthesizeWithMmsSindhi(params: {
  spokenText: string;
  lang: VoiceLang;
}): Promise<{ buffer: Uint8Array; contentType: 'audio/wav' } | null> {
  if (params.lang !== 'sd') return null;
  const endpoint = process.env.MMS_SINDHI_TTS_URL?.trim();
  if (!endpoint) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.HF_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs: params.spokenText }),
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 128) return null;
    return { buffer: new Uint8Array(buf), contentType: 'audio/wav' };
  } catch {
    return null;
  }
}

export async function synthesizeVoiceSpeech(req: TTSRequest): Promise<TTSResult> {
  const startedAt = Date.now();
  const lang: VoiceLang = req.lang === 'sd' || req.lang === 'en' ? req.lang : 'ur';
  // Enforce ONE consistent mature Female voice across the entire app
  const gender: VoiceGender = 'female';
  const speedRate = resolveSpeakingRate(req.speedMode, req.speedRate);
  const localeCode = resolveExplicitLocale(lang);
  const profile = VOICE_PROFILES[lang][gender];

  // Hot-reloadable lexicon + clean speech preparation + Roman Urdu -> Urdu script rescue
  const lexiconEntries = loadHotPronunciationLexicon();
  const preparedBase = await convertRomanUrduIfNeeded(req.text, lang);
  const normalized = toSpokenText(preparedBase, lang, { lexiconEntries });
  const spokenText = normalized.spokenText;

  if (!spokenText) {
    throw new Error('EMPTY_SPOKEN_TEXT');
  }

  const cacheHash = buildAudioCacheKey({
    spokenText,
    lang,
    gender,
    speedRate,
    preferProvider: req.preferProvider,
  });

  // 1. Check drop-in native human recording override first
  const nativeHit = lookupNativeRecording(lang, gender, req.clipId);
  if (nativeHit) {
    recordDiagnosticSuccess('tts');
    return {
      audioBuffer: nativeHit.buffer,
      contentType: nativeHit.contentType,
      provider: 'native-recording',
      voiceLabel: profile.label,
      localeCode,
      audioId: `nat-${req.clipId}-${cacheHash.slice(0, 8)}`,
      cacheStatus: 'native',
      spokenText,
      latencyMs: Date.now() - startedAt,
    };
  }

  // 2. Check in-memory & disk cache (hash of text + voice + speed + lang)
  if (!req.skipCache) {
    const memHit = ttsMemoryCache.get(cacheHash);
    if (memHit && Date.now() - memHit.createdAt < MEMORY_CACHE_TTL_MS) {
      recordDiagnosticSuccess('tts');
      return {
        audioBuffer: memHit.buffer,
        contentType: memHit.contentType,
        provider: memHit.provider,
        voiceLabel: memHit.voiceLabel,
        localeCode,
        audioId: memHit.audioId,
        cacheStatus: 'hit',
        spokenText,
        latencyMs: Date.now() - startedAt,
      };
    }

    const diskHit = readDiskCache(cacheHash);
    if (diskHit) {
      const audioId = `dsk-${cacheHash.slice(0, 10)}`;
      ttsMemoryCache.set(cacheHash, {
        buffer: diskHit.buffer,
        contentType: diskHit.contentType,
        provider: 'disk-cache',
        voiceLabel: profile.label,
        audioId,
        createdAt: Date.now(),
      });
      recordDiagnosticSuccess('tts');
      return {
        audioBuffer: diskHit.buffer,
        contentType: diskHit.contentType,
        provider: 'disk-cache',
        voiceLabel: profile.label,
        localeCode,
        audioId,
        cacheStatus: 'hit',
        spokenText,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  // 3. Execute verified neural provider chain (never Google Translate GTX)
  const providers = getProviderPriorityChain(lang, req.preferProvider);

  for (const provider of providers) {
    let generated:
      | { buffer: Uint8Array; contentType: 'audio/wav' | 'audio/mpeg' }
      | null = null;

    if (provider === 'elevenlabs-v3') {
      generated = await synthesizeWithElevenLabs({ spokenText, lang, profile, speedRate });
    } else if (provider === 'gemini-tts') {
      generated = await synthesizeWithGeminiTts({ spokenText, lang, profile, speedRate });
    } else if (provider === 'azure-neural') {
      generated = await synthesizeWithAzureNeural({ spokenText, lang, profile, speedRate });
    } else if (provider === 'google-cloud-tts') {
      generated = await synthesizeWithGoogleCloudTts({ spokenText, lang, profile, speedRate });
    } else if (provider === 'mms-sindhi') {
      generated = await synthesizeWithMmsSindhi({ spokenText, lang });
    }

    if (generated) {
      const audioId = `${provider.slice(0, 3)}-${cacheHash.slice(0, 10)}`;
      if (ttsMemoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
        const oldestKey = ttsMemoryCache.keys().next().value;
        if (oldestKey) ttsMemoryCache.delete(oldestKey);
      }
      ttsMemoryCache.set(cacheHash, {
        buffer: generated.buffer,
        contentType: generated.contentType,
        provider,
        voiceLabel: profile.label,
        audioId,
        createdAt: Date.now(),
      });
      writeDiskCache(cacheHash, generated.buffer, generated.contentType);
      recordDiagnosticSuccess('tts');

      return {
        audioBuffer: generated.buffer,
        contentType: generated.contentType,
        provider,
        voiceLabel: profile.label,
        localeCode,
        audioId,
        cacheStatus: 'miss',
        spokenText,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  recordDiagnosticEvent({
    service: 'tts',
    category: 'temporary_service_failure',
    code: 'ALL_NEURAL_TTS_UNAVAILABLE',
    statusCode: 503,
    severity: 'error',
    summary: redactSecrets(
      `All neural TTS providers unavailable for ${localeCode}; advising client offline fallback.`
    ),
  });
  throw new Error('NEURAL_TTS_UNAVAILABLE');
}
