import { NextRequest, NextResponse } from 'next/server';
import { VerifyImageRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { verifyLeafImageWithVision } from '@/lib/gemini';
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
      service: 'vision',
      category: 'rate_limited',
      code: 'VERIFY_RATE_LIMITED',
      statusCode: 429,
      severity: 'warn',
      summary: 'Image verify endpoint rate limit exceeded.',
    });
    return NextResponse.json(
      {
        error: 'service_busy',
        request_id: requestId,
        user_message: getCustomerErrorMessage('rate_limited', 'scan'),
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const requestId = recordDiagnosticEvent({
      service: 'vision',
      category: 'invalid_image_input',
      code: 'VERIFY_INVALID_JSON',
      statusCode: 400,
      severity: 'warn',
      summary: 'Verify image request JSON invalid.',
    });
    return NextResponse.json(
      {
        error: 'invalid_request',
        request_id: requestId,
        user_message: getCustomerErrorMessage('invalid_image_input', 'scan'),
      },
      { status: 400 }
    );
  }

  const parsed = VerifyImageRequestSchema.safeParse(body);
  if (!parsed.success) {
    const requestId = recordDiagnosticEvent({
      service: 'vision',
      category: 'invalid_image_input',
      code: 'VERIFY_SCHEMA_FAILED',
      statusCode: 400,
      severity: 'warn',
      summary: 'Verify image request rejected by payload limits.',
    });
    return NextResponse.json(
      {
        error: 'invalid_request',
        request_id: requestId,
        user_message: getCustomerErrorMessage('invalid_image_input', 'scan'),
      },
      { status: 400 }
    );
  }

  try {
    const secondOpinion = await verifyLeafImageWithVision(
      parsed.data.image,
      parsed.data.crop,
      parsed.data.label
    );
    recordDiagnosticSuccess('vision');
    return NextResponse.json({ secondOpinion });
  } catch (err) {
    const requestId = recordDiagnosticEvent({
      service: 'vision',
      category: 'temporary_service_failure',
      code: 'VERIFY_VISION_FAILED',
      statusCode: 503,
      severity: 'error',
      summary: err instanceof Error ? redactSecrets(err.message) : 'Verify image vision failure',
    });
    return NextResponse.json(
      {
        error: 'scan_unavailable',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'scan'),
      },
      { status: 503 }
    );
  }
}
