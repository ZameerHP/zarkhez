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

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
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
  let mimeType = 'audio/webm';
  let lang: VoiceLang = 'ur';
  let hints: string[] | undefined;

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
        mimeType = blob.type || 'audio/webm';
      }
    } else {
      const body = (await req.json()) as {
        audioBase64?: string;
        mimeType?: string;
        lang?: string;
        hints?: string[];
      };
      audioBase64 = (body.audioBase64 || '').replace(/^data:[^;]+;base64,/, '');
      mimeType = body.mimeType || 'audio/webm';
      lang = parseLang(body.lang);
      hints = Array.isArray(body.hints) ? body.hints : undefined;
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
    });
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (err) {
    const requestId = recordDiagnosticEvent({
      service: 'tts',
      category: 'temporary_service_failure',
      code: 'STT_FAILED',
      statusCode: 502,
      severity: 'warn',
      summary: err instanceof Error ? redactSecrets(err.message) : 'Server speech recognition failed',
    });
    return NextResponse.json(
      {
        error: 'stt_unavailable',
        fallback: 'browser-web-speech',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'chat'),
      },
      { status: 502 }
    );
  }
}
