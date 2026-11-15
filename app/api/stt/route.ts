import { NextRequest, NextResponse } from 'next/server';
import { getCustomerErrorMessage, redactSecrets } from '@/lib/error-sanitizer';
import { checkRateLimit } from '@/lib/ratelimit';
import { recordDiagnosticEvent } from '@/lib/server/diagnostics-store';
import { transcribeFarmAudio } from '@/lib/voice/stt';
import type { VoiceLang } from '@/lib/voice/types';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

function parseLang(raw?: string | null): VoiceLang {
  const low = (raw || '').toLowerCase();
  if (low.startsWith('sd') || low.includes('sindhi')) return 'sd';
  if (low.startsWith('en') || low.includes('english')) return 'en';
  return 'ur';
}

function normalizeMimeType(raw?: string | null): string {
  const clean = (raw || 'audio/wav').split(';')[0].trim().toLowerCase();
  if (!clean || !clean.startsWith('audio/')) return 'audio/wav';
  return clean;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip, {
    maxRequests: 80,
    windowMs: 10 * 60 * 1000,
    namespace: 'stt',
  });
  if (!rate.success) {
    const requestId = recordDiagnosticEvent({
      service: 'tts',
      category: 'rate_limited',
      code: 'STT_RATE_LIMITED',
      statusCode: 429,
      severity: 'warn',
      summary: 'Speech recognition rate limit exceeded.',
    });
    return NextResponse.json(
      {
        error: 'service_busy',
        fallback: 'browser-web-speech',
        request_id: requestId,
        user_message: getCustomerErrorMessage('rate_limited', 'chat'),
      },
      { status: 429 }
    );
  }

  let audioBase64 = '';
  let mimeType = 'audio/wav';
  let lang: VoiceLang = 'ur';
  let hints: string[] | undefined;
  let previousContext: string | undefined;

  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('audio');
      lang = parseLang(String(form.get('lang') || 'ur'));
      const hintsRaw = form.get('hints');
      if (typeof hintsRaw === 'string' && hintsRaw.trim()) {
        hints = hintsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      }
      const prevRaw = form.get('previousContext');
      if (typeof prevRaw === 'string' && prevRaw.trim()) {
        previousContext = prevRaw.trim().slice(-200);
      }

      if (file && typeof file !== 'string' && typeof file.arrayBuffer === 'function') {
        const blob = file as Blob;
        if (blob.size > 8 * 1024 * 1024) {
          return NextResponse.json(
            {
              error: 'audio_too_large',
              user_message: getCustomerErrorMessage('invalid_image_input', 'chat'),
            },
            { status: 413 }
          );
        }
        const ab = await blob.arrayBuffer();
        audioBase64 = Buffer.from(ab).toString('base64');
        mimeType = normalizeMimeType(blob.type || 'audio/wav');
      }
    } else {
      const body = (await req.json()) as {
        audioBase64?: string;
        mimeType?: string;
        lang?: string;
        hints?: string[];
        previousContext?: string;
      };
      audioBase64 = (body.audioBase64 || '').replace(/^data:[^;]+;base64,/, '');
      mimeType = normalizeMimeType(body.mimeType || 'audio/wav');
      lang = parseLang(body.lang);
      hints = Array.isArray(body.hints) ? body.hints : undefined;
      previousContext =
        typeof body.previousContext === 'string' && body.previousContext.trim()
          ? body.previousContext.trim().slice(-200)
          : undefined;
    }
  } catch {
    return NextResponse.json(
      {
        error: 'invalid_audio_payload',
        user_message: getCustomerErrorMessage('temporary_service_failure', 'chat'),
      },
      { status: 400 }
    );
  }

  if (!audioBase64 || audioBase64.length < 32) {
    return NextResponse.json(
      {
        error: 'empty_audio',
        user_message: getCustomerErrorMessage('temporary_service_failure', 'chat'),
      },
      { status: 400 }
    );
  }

  try {
    const result = await transcribeFarmAudio({
      audioBase64,
      mimeType,
      lang,
      hints,
      previousContext,
    });
    return NextResponse.json(
      {
        ...result,
        processingMs: Date.now() - startedAt,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  } catch (err) {
    const rawCode = err instanceof Error ? err.message : 'STT_UNAVAILABLE';
    const isTimeout = rawCode === 'STT_TIMEOUT';
    const isQuota = rawCode === 'STT_QUOTA_EXHAUSTED';
    const statusCode = isTimeout ? 504 : isQuota ? 429 : 502;
    const errorKey = isTimeout
      ? 'stt_timeout'
      : isQuota
      ? 'service_busy'
      : 'stt_unavailable';

    const requestId = recordDiagnosticEvent({
      service: 'tts',
      category: isQuota ? 'rate_limited' : 'temporary_service_failure',
      code: rawCode || 'STT_FAILED',
      statusCode,
      severity: 'warn',
      summary: err instanceof Error ? redactSecrets(err.message) : 'Server speech recognition failed',
    });
    return NextResponse.json(
      {
        error: errorKey,
        fallback: 'browser-web-speech',
        request_id: requestId,
        user_message: getCustomerErrorMessage(isQuota ? 'rate_limited' : 'temporary_service_failure', 'chat'),
      },
      { status: statusCode }
    );
  }
}
