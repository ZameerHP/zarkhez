import { NextRequest, NextResponse } from 'next/server';
import { ChatRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import {
  generateFallbackChatReply,
  generateVoiceDualReply,
  getGeminiApiKey,
  streamGeminiChatResponse,
} from '@/lib/gemini';
import { detectUserLanguageMode } from '@/lib/advisor-prompt';
import { getCustomerErrorMessage, redactSecrets } from '@/lib/error-sanitizer';
import {
  recordDiagnosticEvent,
  recordDiagnosticSuccess,
} from '@/lib/server/diagnostics-store';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    const requestId = recordDiagnosticEvent({
      service: 'chat',
      category: 'rate_limited',
      code: 'CHAT_RATE_LIMITED',
      statusCode: 429,
      severity: 'warn',
      summary: 'Chat endpoint rate limit reached.',
    });
    return NextResponse.json(
      {
        error: 'service_busy',
        request_id: requestId,
        user_message: getCustomerErrorMessage('rate_limited', 'chat'),
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const requestId = recordDiagnosticEvent({
      service: 'chat',
      category: 'invalid_image_input',
      code: 'CHAT_INVALID_JSON',
      statusCode: 400,
      severity: 'warn',
      summary: 'Chat request JSON parse failed.',
    });
    return NextResponse.json(
      {
        error: 'invalid_request',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'chat'),
      },
      { status: 400 }
    );
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const requestId = recordDiagnosticEvent({
      service: 'chat',
      category: 'invalid_image_input',
      code: 'CHAT_VALIDATION_FAILED',
      statusCode: 400,
      severity: 'warn',
      summary: 'Chat request payload validation failed.',
    });
    return NextResponse.json(
      {
        error: 'invalid_request',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'chat'),
      },
      { status: 400 }
    );
  }

  const { messages, context, lang, voiceLang, voiceMode } = parsed.data;
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  const detectedLang = detectUserLanguageMode(lastUserMsg, voiceLang, lang, messages);

  if (voiceMode) {
    const resolvedVoiceLang =
      voiceLang === 'sd' && detectedLang.mode !== 'en'
        ? 'sd'
        : detectedLang.voiceLang;
    const dual = await generateVoiceDualReply(
      messages,
      context
        ? {
            name: context.farmerName,
            farmerId: context.farmerId,
            district: context.region,
            crop: context.crop,
            weatherSummary: context.weatherSummary,
          }
        : undefined,
      resolvedVoiceLang
    );
    recordDiagnosticSuccess('chat');
    return NextResponse.json(dual, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }

  const apiKey = getGeminiApiKey();
  const encoder = new TextEncoder();

  if (!apiKey) {
    recordDiagnosticEvent({
      service: 'chat',
      category: 'permanent_config_error',
      code: 'CHAT_FALLBACK_NO_KEY',
      statusCode: 503,
      severity: 'warn',
      summary: 'Chat using fallback response because server AI key is not set.',
    });
    const reply = generateFallbackChatReply(
      lastUserMsg,
      detectedLang.mode === 'en' ? 'en' : lang,
      context,
      messages,
      detectedLang.mode
    );
    const words = reply.split(' ');
    const stepDelayMs = words.length > 80 ? 4 : 12;
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? '' : ' ') + words[i];
          controller.enqueue(encoder.encode(chunk));
          await new Promise((r) => setTimeout(r, stepDelayMs));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, private',
      },
    });
  }

  // Stream AI response smoothly without exposing upstream provider details
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const fullReply = await streamGeminiChatResponse(
          messages,
          context
            ? {
                name: context.farmerName,
                farmerId: context.farmerId,
                district: context.region,
                crop: context.crop,
                weatherSummary: context.weatherSummary,
              }
            : undefined,
          lang,
          voiceLang
        );

        recordDiagnosticSuccess('chat');
        const words = fullReply.split(' ');
        const stepDelayMs = words.length > 80 ? 3 : 10;
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? '' : ' ') + words[i];
          controller.enqueue(encoder.encode(chunk));
          await new Promise((r) => setTimeout(r, stepDelayMs));
        }
      } catch (err) {
        recordDiagnosticEvent({
          service: 'chat',
          category: 'temporary_service_failure',
          code: 'CHAT_STREAM_FALLBACK',
          statusCode: 503,
          severity: 'warn',
          summary: err instanceof Error ? redactSecrets(err.message) : 'Chat upstream failed; served fallback.',
        });
        const fallback = generateFallbackChatReply(
          lastUserMsg,
          detectedLang.mode === 'en' ? 'en' : lang,
          context,
          messages,
          detectedLang.mode
        );
        controller.enqueue(encoder.encode(fallback));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, private',
    },
  });
}
