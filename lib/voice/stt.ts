import type { STTRequest, STTResult, SttProviderId, VoiceLang } from './types';
import { resolveExplicitLocale } from './script-guard';
import { loadHotPronunciationLexicon, readServerEnv } from './server-lexicon';
import { getLexiconReplacement } from './lexicon-loader';
import { redactSecrets } from '../error-sanitizer';
import { recordDiagnosticEvent, recordDiagnosticSuccess } from '../server/diagnostics-store';

function buildVocabularyBoostList(lang: VoiceLang, extraHints?: string[]): string[] {
  const entries = loadHotPronunciationLexicon();
  const terms = new Set<string>(extraHints || []);
  for (const e of entries) {
    terms.add(e.term);
    terms.add(getLexiconReplacement(e, lang));
  }
  return Array.from(terms).filter(Boolean).slice(0, 60);
}

async function transcribeWithGeminiStt(
  req: STTRequest,
  boostTerms: string[]
): Promise<STTResult | null> {
  const apiKey = readServerEnv(['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  if (!apiKey) return null;

  const startedAt = Date.now();
  const localeCode = resolveExplicitLocale(req.lang);
  const scriptLabel =
    req.lang === 'sd'
      ? 'Pakistani Sindhi Arabic script (preserving ڀ ٻ ڄ ڃ ڇ ڏ ڊ ڌ ڍ ڙ ڦ ڪ ڳ ڱ ڻ ٿ ٺ ٽ)'
      : req.lang === 'ur'
      ? 'Pakistani Urdu Perso-Arabic script'
      : 'English';

  const prompt = `Transcribe this farmer's spoken audio verbatim in ${scriptLabel}. Locale hint: ${localeCode}. Common domain terms (boost accuracy for these if spoken): ${boostTerms.join(', ')}. Output ONLY the exact transcribed words without quotes, prefixes, or commentary.`;

  const modelsToTry = [
    'gemini-3-flash-preview',
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
  ];

  for (const model of modelsToTry) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: req.mimeType || 'audio/webm',
                      data: req.audioBase64,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: { temperature: 0 },
          }),
          signal: AbortSignal.timeout(14000),
        }
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) break;
        continue;
      }
      const data = await res.json();
      const parts = (data?.candidates?.[0]?.content?.parts || []) as Array<{
        text?: string;
        thought?: boolean;
      }>;
      const transcript = parts
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text!.trim())
        .join(' ')
        .trim();
      if (transcript) {
        return {
          transcript,
          localeCode,
          provider: 'gemini-audio-stt',
          latencyMs: Date.now() - startedAt,
        };
      }
    } catch {
      // try next Gemini STT model
    }
  }
  return null;
}

async function transcribeWithOpenAiWhisper(
  req: STTRequest,
  boostTerms: string[]
): Promise<STTResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const startedAt = Date.now();
  const localeCode = resolveExplicitLocale(req.lang);
  try {
    const audioBytes = Buffer.from(req.audioBase64, 'base64');
    const ext = req.mimeType.includes('wav')
      ? 'wav'
      : req.mimeType.includes('mp4')
      ? 'mp4'
      : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audioBytes], { type: req.mimeType || 'audio/webm' }), `speech.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', req.lang);
    form.append('prompt', boostTerms.join(', '));

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    const transcript = (data.text || '').trim();
    if (!transcript) return null;
    return {
      transcript,
      localeCode,
      provider: 'openai-whisper',
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return null;
  }
}

async function transcribeWithAssemblyAi(
  req: STTRequest,
  boostTerms: string[]
): Promise<STTResult | null> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) return null;

  const startedAt = Date.now();
  const localeCode = resolveExplicitLocale(req.lang);
  try {
    const audioBytes = Buffer.from(req.audioBase64, 'base64');
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: audioBytes,
      signal: AbortSignal.timeout(12000),
    });
    if (!uploadRes.ok) return null;
    const uploadJson = (await uploadRes.json()) as { upload_url?: string };
    if (!uploadJson.upload_url) return null;

    const createRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: uploadJson.upload_url,
        language_code: req.lang,
        word_boost: boostTerms.slice(0, 40),
        boost_param: 'high',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!createRes.ok) return null;
    const job = (await createRes.json()) as { id?: string };
    if (!job.id) return null;

    for (let attempt = 0; attempt < 16; attempt++) {
      await new Promise((r) => setTimeout(r, 900));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.id}`, {
        headers: { Authorization: apiKey },
        signal: AbortSignal.timeout(8000),
      });
      if (!pollRes.ok) break;
      const statusData = (await pollRes.json()) as { status?: string; text?: string };
      if (statusData.status === 'completed' && statusData.text) {
        return {
          transcript: statusData.text.trim(),
          localeCode,
          provider: 'assemblyai',
          latencyMs: Date.now() - startedAt,
        };
      }
      if (statusData.status === 'error') break;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function transcribeFarmAudio(req: STTRequest): Promise<STTResult> {
  const boostTerms = buildVocabularyBoostList(req.lang, req.hints);
  const providers: SttProviderId[] = [
    'openai-whisper',
    'gemini-audio-stt',
    'assemblyai',
  ];

  for (const p of providers) {
    let result: STTResult | null = null;
    if (p === 'openai-whisper') result = await transcribeWithOpenAiWhisper(req, boostTerms);
    else if (p === 'gemini-audio-stt') result = await transcribeWithGeminiStt(req, boostTerms);
    else if (p === 'assemblyai') result = await transcribeWithAssemblyAi(req, boostTerms);

    if (result && result.transcript.trim()) {
      recordDiagnosticSuccess('tts');
      return result;
    }
  }

  recordDiagnosticEvent({
    service: 'tts',
    category: 'temporary_service_failure',
    code: 'STT_PROVIDERS_UNAVAILABLE',
    statusCode: 503,
    severity: 'warn',
    summary: redactSecrets('All server STT providers unavailable; falling back to browser recognition.'),
  });
  throw new Error('STT_UNAVAILABLE');
}
