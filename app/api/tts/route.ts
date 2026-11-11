import { NextRequest, NextResponse } from 'next/server';
import { getCustomerErrorMessage, redactSecrets } from '@/lib/error-sanitizer';
import { recordDiagnosticEvent } from '@/lib/server/diagnostics-store';
import { synthesizeVoiceSpeech } from '@/lib/voice/service';
import type {
  VoiceGender,
  VoiceLang,
  VoiceProviderId,
  VoiceSpeedMode,
} from '@/lib/voice/types';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

function parseVoiceLang(raw?: string | null): VoiceLang {
  const low = (raw || '').toLowerCase();
  if (low.startsWith('sd') || low.includes('sindhi')) return 'sd';
  if (low.startsWith('en') || low.includes('english')) return 'en';
  return 'ur';
}

function parseGender(rawVoice?: string | null, rawGender?: string | null): VoiceGender {
  const combined = `${rawGender || ''} ${rawVoice || ''}`.toLowerCase();
  if (combined.includes('male') && !combined.includes('female')) return 'male';
  if (combined.includes('asad') || combined.includes('orus') || combined.includes('charon') || combined.includes('sachal') || combined.includes('guy')) {
    return 'male';
  }
  return 'female';
}

function parseSpeed(rawSpeed?: string | number | null, rawMode?: string | null): {
  speedMode: VoiceSpeedMode;
  speedRate?: number;
} {
  if (rawMode === 'slow') return { speedMode: 'slow', speedRate: 0.82 };
  if (typeof rawSpeed === 'number' && Number.isFinite(rawSpeed)) {
    return {
      speedMode: rawSpeed <= 0.85 ? 'slow' : 'normal',
      speedRate: Math.min(1.25, Math.max(0.7, rawSpeed)),
    };
  }
  if (typeof rawSpeed === 'string' && rawSpeed.trim()) {
    const num = Number(rawSpeed);
    if (Number.isFinite(num)) {
      return {
        speedMode: num <= 0.85 ? 'slow' : 'normal',
        speedRate: Math.min(1.25, Math.max(0.7, num)),
      };
    }
  }
  return { speedMode: 'normal', speedRate: 1.0 };
}

async function handleTtsSynthesis(params: {
  text: string;
  lang: VoiceLang;
  gender: VoiceGender;
  speedMode: VoiceSpeedMode;
  speedRate?: number;
  clipId?: string;
  preferProvider?: VoiceProviderId;
  skipCache?: boolean;
}) {
  if (!params.text || !params.text.trim()) {
    return NextResponse.json(
      {
        error: 'missing_text',
        user_message: getCustomerErrorMessage('temporary_service_failure', 'tts'),
      },
      { status: 400 }
    );
  }

  try {
    const result = await synthesizeVoiceSpeech({
      text: params.text.trim().slice(0, 1800),
      lang: params.lang,
      gender: params.gender,
      speedMode: params.speedMode,
      speedRate: params.speedRate,
      clipId: params.clipId,
      preferProvider: params.preferProvider,
      skipCache: params.skipCache,
    });

    return new Response(Buffer.from(result.audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-Voice-Provider': result.provider,
        'X-Voice-Locale': result.localeCode,
        'X-Voice-Cache': result.cacheStatus,
        'X-Audio-Id': result.audioId,
        'X-Spoken-Text': encodeURIComponent(result.spokenText),
      },
    });
  } catch (err) {
    const requestId = recordDiagnosticEvent({
      service: 'tts',
      category: 'temporary_service_failure',
      code: 'TTS_SYNTHESIS_FAILED',
      statusCode: 502,
      severity: 'error',
      summary: err instanceof Error ? redactSecrets(err.message) : 'Neural TTS synthesis failed',
    });

    return NextResponse.json(
      {
        error: 'voice_unavailable',
        fallback: 'browser-offline',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'tts'),
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get('text') || '').trim();
  const lang = parseVoiceLang(searchParams.get('lang'));
  const gender = parseGender(searchParams.get('voice'), searchParams.get('gender'));
  const { speedMode, speedRate } = parseSpeed(
    searchParams.get('speed'),
    searchParams.get('speedMode')
  );
  const clipId = searchParams.get('clipId')?.trim() || undefined;
  const preferProvider =
    (searchParams.get('provider')?.trim() as VoiceProviderId | undefined) || undefined;
  const skipCache = searchParams.get('nocache') === '1';

  return handleTtsSynthesis({
    text,
    lang,
    gender,
    speedMode,
    speedRate,
    clipId,
    preferProvider,
    skipCache,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      text?: string;
      lang?: string;
      voice?: string;
      gender?: string;
      speed?: number | string;
      speedMode?: string;
      clipId?: string;
      provider?: VoiceProviderId;
      skipCache?: boolean;
    };

    const lang = parseVoiceLang(body.lang);
    const gender = parseGender(body.voice, body.gender);
    const { speedMode, speedRate } = parseSpeed(body.speed, body.speedMode);

    return handleTtsSynthesis({
      text: (body.text || '').trim(),
      lang,
      gender,
      speedMode,
      speedRate,
      clipId: body.clipId,
      preferProvider: body.provider,
      skipCache: body.skipCache,
    });
  } catch {
    return NextResponse.json(
      {
        error: 'invalid_tts_request',
        user_message: getCustomerErrorMessage('temporary_service_failure', 'tts'),
      },
      { status: 400 }
    );
  }
}
