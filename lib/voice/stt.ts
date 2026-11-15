import type { STTRequest, STTResult, SttProviderId, VoiceLang } from './types';
import { resolveExplicitLocale } from './script-guard';
import { loadHotPronunciationLexicon } from './server-lexicon';
import { getLexiconReplacement } from './lexicon-loader';
import { redactSecrets } from '../error-sanitizer';
import { recordDiagnosticEvent, recordDiagnosticSuccess } from '../server/diagnostics-store';
import {
  executeGeminiWithFailover,
  hasAnyConfiguredGeminiAccount,
  readGeminiEnvValue,
} from '../server/gemini-pool';
import { normalizeSttSegment } from './transcript-merger';

function normalizeAudioMimeType(raw?: string): string {
  const base = (raw || 'audio/wav').split(';')[0].trim().toLowerCase();
  if (!base || !base.startsWith('audio/')) return 'audio/wav';
  return base;
}

function buildVocabularyBoostList(lang: VoiceLang, extraHints?: string[]): string[] {
  const entries = loadHotPronunciationLexicon();
  const terms = new Set<string>(extraHints || []);
  for (const e of entries) {
    terms.add(e.term);
    terms.add(getLexiconReplacement(e, lang));
  }
  return Array.from(terms).filter(Boolean).slice(0, 60);
}

type GeminiSttOutcome =
  | { kind: 'ok'; result: STTResult }
  | { kind: 'no_speech'; latencyMs: number; modelUsed?: string; failoverSteps?: number }
  | { kind: 'error'; reason: 'timeout' | 'quota_exhausted' | 'unavailable' | 'unconfigured' };

function buildGeminiSttPrompt(
  lang: VoiceLang,
  localeCode: string,
  boostTerms: string[],
  previousContext?: string
): string {
  const scriptRule =
    lang === 'sd'
      ? 'Transcribe strictly in Pakistani Sindhi (Perso-Arabic script preserving ڀ ٻ ڄ ڃ ڇ ڏ ڊ ڌ ڍ ڙ ڦ ڪ ڳ ڱ ڻ ٿ ٺ ٽ). Keep spoken English fertilizer/pesticide names or numbers verbatim. NEVER translate Sindhi into Urdu or English.'
      : lang === 'ur'
      ? 'Transcribe strictly in the speaker’s actual spoken words: Pakistani Urdu (Perso-Arabic script) while preserving mixed English, Roman Urdu, crop names, pesticide/fertilizer brands (such as DAP, Urea, NP, Imidacloprid, Rust), and numbers accurately. NEVER translate Urdu into English or rewrite sentences.'
      : 'Transcribe verbatim in English while preserving Pakistani agricultural terms, Roman Urdu crop/brand names, and quantities faithfully. NEVER invent or rewrite words.';

  const termsLine =
    boostTerms.length > 0
      ? `\nAgricultural reference terms (keep spelling exact when heard): ${boostTerms.slice(0, 45).join(', ')}.`
      : '';

  const safePrev = (previousContext || '').replace(/\s+/g, ' ').trim().slice(-160);
  const contextLine = safePrev
    ? `\nImmediate prior context (for continuity only — do NOT repeat prior words unless spoken again in this clip): "${safePrev}".`
    : '';

  return (
    `Listen strictly to this audio clip. If the audio is silent, static clicks, wind noise, or contains NO clear human speech, output EXACTLY [NO_SPEECH]. ` +
    `Otherwise transcribe ONLY the words spoken inside this audio clip (${localeCode}).\n` +
    `${scriptRule}${termsLine}${contextLine}\n` +
    `Output ONLY the transcript text with no explanations or labels.`
  );
}

async function transcribeWithGeminiStt(
  req: STTRequest,
  boostTerms: string[]
): Promise<GeminiSttOutcome> {
  if (!hasAnyConfiguredGeminiAccount()) {
    return { kind: 'error', reason: 'unconfigured' };
  }

  const startedAt = Date.now();
  const localeCode = resolveExplicitLocale(req.lang);
  const prompt = buildGeminiSttPrompt(req.lang, localeCode, boostTerms, req.previousContext);
  const mimeType = normalizeAudioMimeType(req.mimeType);

  const configuredFast = readGeminiEnvValue(['GEMINI_MODEL_FAST'])?.trim();
  const modelsToTry = Array.from(
    new Set([
      ...(configuredFast ? [configuredFast] : []),
      'gemini-2.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3-flash-preview',
      'gemini-flash-latest',
    ])
  );

  const extractTranscript = (data: unknown): string => {
    const parts = ((data as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    })?.candidates?.[0]?.content?.parts || []);
    const joined = parts
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text!.trim())
      .join(' ')
      .trim()
      .replace(/^["'«»“”`]+|["'«»“”`]+$/g, '')
      .trim();
    return joined;
  };

  const result = await executeGeminiWithFailover({
    models: modelsToTry,
    timeoutMs: 11_000,
    overallDeadlineMs: 26_000,
    buildRequestBody: () => ({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: req.audioBase64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
    shouldRetryEmptyPayload: (json) => !extractTranscript(json),
  });

  if (!result.ok) {
    const reason =
      result.category === 'timeout'
        ? 'timeout'
        : result.category === 'quota_exhausted'
        ? 'quota_exhausted'
        : 'unavailable';
    return { kind: 'error', reason };
  }

  const rawTx = extractTranscript(result.data);
  if (/\[?\s*NO[_\s-]*SPEECH\s*\]?|^\s*(?:silence|\[silence\]|no audio)\s*$/i.test(rawTx)) {
    return {
      kind: 'no_speech',
      latencyMs: Date.now() - startedAt,
      modelUsed: result.modelUsed,
      failoverSteps: result.failoverSteps,
    };
  }

  const cleanedTx = normalizeSttSegment(rawTx);
  if (!cleanedTx) {
    return {
      kind: 'no_speech',
      latencyMs: Date.now() - startedAt,
      modelUsed: result.modelUsed,
      failoverSteps: result.failoverSteps,
    };
  }

  return {
    kind: 'ok',
    result: {
      transcript: cleanedTx,
      localeCode,
      provider: 'gemini-audio-stt',
      latencyMs: Date.now() - startedAt,
      modelUsed: result.modelUsed,
      failoverSteps: result.failoverSteps,
    },
  };
}

async function transcribeWithOpenAiWhisper(
  req: STTRequest,
  boostTerms: string[]
): Promise<STTResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const startedAt = Date.now();
  const localeCode = resolveExplicitLocale(req.lang);
  const cleanMime = normalizeAudioMimeType(req.mimeType);
  try {
    const audioBytes = Buffer.from(req.audioBase64, 'base64');
    const ext = cleanMime.includes('wav')
      ? 'wav'
      : cleanMime.includes('mp4') || cleanMime.includes('aac')
      ? 'mp4'
      : cleanMime.includes('ogg')
      ? 'ogg'
      : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audioBytes], { type: cleanMime }), `speech.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', req.lang);
    const contextPrompt = [boostTerms.join(', '), req.previousContext?.trim()]
      .filter(Boolean)
      .join(' | ');
    form.append('prompt', contextPrompt);

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
  const localeCode = resolveExplicitLocale(req.lang);
  const providers: SttProviderId[] = [
    'gemini-audio-stt',
    'openai-whisper',
    'assemblyai',
  ];

  let geminiFailureReason: 'timeout' | 'quota_exhausted' | 'unavailable' | 'unconfigured' | null =
    null;

  for (const p of providers) {
    if (p === 'gemini-audio-stt') {
      const outcome = await transcribeWithGeminiStt(req, boostTerms);
      if (outcome.kind === 'ok') {
        recordDiagnosticSuccess('tts');
        return outcome.result;
      }
      if (outcome.kind === 'no_speech') {
        recordDiagnosticSuccess('tts');
        return {
          transcript: '',
          localeCode,
          provider: 'gemini-audio-stt',
          latencyMs: outcome.latencyMs,
          modelUsed: outcome.modelUsed,
          failoverSteps: outcome.failoverSteps,
        };
      }
      geminiFailureReason = outcome.reason;
      continue;
    }

    const result =
      p === 'openai-whisper'
        ? await transcribeWithOpenAiWhisper(req, boostTerms)
        : await transcribeWithAssemblyAi(req, boostTerms);

    if (result && result.transcript.trim()) {
      recordDiagnosticSuccess('tts');
      return {
        ...result,
        fallbackReason: geminiFailureReason || undefined,
      };
    }
  }

  const isTimeout = geminiFailureReason === 'timeout';
  const isQuota = geminiFailureReason === 'quota_exhausted';
  const errorCode = isTimeout
    ? 'STT_TIMEOUT'
    : isQuota
    ? 'STT_QUOTA_EXHAUSTED'
    : 'STT_UNAVAILABLE';

  recordDiagnosticEvent({
    service: 'tts',
    category: isQuota ? 'rate_limited' : 'temporary_service_failure',
    code: errorCode,
    statusCode: isTimeout ? 504 : isQuota ? 429 : 503,
    severity: 'warn',
    summary: redactSecrets(
      isTimeout
        ? 'Gemini speech recognition request timed out.'
        : 'All server STT providers unavailable; falling back to browser recognition.'
    ),
  });
  throw new Error(errorCode);
}
