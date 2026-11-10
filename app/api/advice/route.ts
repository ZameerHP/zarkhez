import { NextRequest, NextResponse } from 'next/server';
import { AdviceRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { generateCropAdvice } from '@/lib/gemini';
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
      service: 'advice',
      category: 'rate_limited',
      code: 'ADVICE_RATE_LIMITED',
      statusCode: 429,
      severity: 'warn',
      summary: 'Advice endpoint rate limit reached.',
    });
    return NextResponse.json(
      {
        error: 'service_busy',
        request_id: requestId,
        user_message: getCustomerErrorMessage('rate_limited', 'general'),
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const requestId = recordDiagnosticEvent({
      service: 'advice',
      category: 'invalid_image_input',
      code: 'ADVICE_INVALID_JSON',
      statusCode: 400,
      severity: 'warn',
      summary: 'Advice request body could not be parsed as JSON.',
    });
    return NextResponse.json(
      {
        error: 'invalid_request',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'general'),
      },
      { status: 400 }
    );
  }

  const parsed = AdviceRequestSchema.safeParse(body);
  if (!parsed.success) {
    const requestId = recordDiagnosticEvent({
      service: 'advice',
      category: 'invalid_image_input',
      code: 'ADVICE_VALIDATION_FAILED',
      statusCode: 400,
      severity: 'warn',
      summary: 'Advice request payload failed schema check.',
    });
    return NextResponse.json(
      {
        error: 'invalid_request',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'general'),
      },
      { status: 400 }
    );
  }

  try {
    const { label, confidence, crop, image } = parsed.data;
    const result = await generateCropAdvice(label, confidence, crop, image);
    recordDiagnosticSuccess('advice');
    return NextResponse.json(result);
  } catch (err) {
    const requestId = recordDiagnosticEvent({
      service: 'advice',
      category: 'temporary_service_failure',
      code: 'ADVICE_GENERATION_FAILED',
      statusCode: 503,
      severity: 'error',
      summary: err instanceof Error ? redactSecrets(err.message) : 'Advice generation failure',
    });
    return NextResponse.json(
      {
        error: 'advice_unavailable',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'general'),
      },
      { status: 503 }
    );
  }
}
