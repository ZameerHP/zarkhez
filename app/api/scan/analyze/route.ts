import { NextRequest, NextResponse } from 'next/server';
import { CropAnalysisRequestSchema, PublicScanError } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { analyzeCropImageWithGemini, GeminiVisionError } from '@/lib/gemini';
import {
  getCustomerErrorMessage,
  redactSecrets,
} from '@/lib/error-sanitizer';
import {
  recordDiagnosticEvent,
  recordDiagnosticSuccess,
} from '@/lib/server/diagnostics-store';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function makePublicErrorResponse(
  payload: PublicScanError,
  status: number
): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    const requestId = recordDiagnosticEvent({
      service: 'vision',
      category: 'rate_limited',
      code: 'APP_RATE_LIMITED',
      statusCode: 429,
      severity: 'warn',
      summary: 'Client IP exceeded sliding-window scan rate limit.',
    });
    return makePublicErrorResponse(
      {
        error: 'structured_scan_error',
        request_id: requestId,
        error_category: 'rate_limited',
        retryable: true,
        user_message: getCustomerErrorMessage('rate_limited', 'scan'),
      },
      429
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const requestId = recordDiagnosticEvent({
      service: 'vision',
      category: 'invalid_image_input',
      code: 'INVALID_REQUEST_JSON',
      statusCode: 400,
      severity: 'warn',
      summary: 'Scan request body could not be parsed as JSON.',
    });
    return makePublicErrorResponse(
      {
        error: 'structured_scan_error',
        request_id: requestId,
        error_category: 'invalid_image_input',
        retryable: false,
        user_message: getCustomerErrorMessage('invalid_image_input', 'scan'),
      },
      400
    );
  }

  const parsed = CropAnalysisRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldPaths = parsed.error.issues.map(
      (iss) => iss.path.map(String).join('.') || '(body)'
    );
    const requestId = recordDiagnosticEvent({
      service: 'vision',
      category: 'invalid_image_input',
      code: 'INVALID_SCAN_PAYLOAD',
      statusCode: 400,
      severity: 'warn',
      summary: 'Request payload failed input schema validation.',
      fieldPaths,
    });

    return makePublicErrorResponse(
      {
        error: 'structured_scan_error',
        request_id: requestId,
        error_category: 'invalid_image_input',
        retryable: false,
        user_message: getCustomerErrorMessage('invalid_image_input', 'scan'),
      },
      400
    );
  }

  const {
    image,
    selectedCrop,
    confirmMismatchOverride,
    clientQuality,
    scanMode,
    region,
    additionalImages,
    fieldContext,
  } = parsed.data;

  try {
    const diagnosis = await analyzeCropImageWithGemini(
      image,
      selectedCrop,
      confirmMismatchOverride,
      clientQuality,
      {
        scanMode,
        region,
        additionalImages,
        fieldContext,
      }
    );

    recordDiagnosticSuccess('vision');
    return NextResponse.json(diagnosis, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (err: unknown) {
    if (err instanceof GeminiVisionError) {
      const requestId = recordDiagnosticEvent({
        service: 'vision',
        category: err.errorCategory,
        code: err.code,
        statusCode: err.statusCode,
        severity: err.statusCode >= 500 ? 'error' : 'warn',
        summary: err.message,
        fieldPaths: err.fieldErrors?.map((f) => f.path),
      });
      console.error(
        `[API /api/scan/analyze] [${requestId}] Classified [${err.code} / ${err.errorCategory}]`
      );
      return makePublicErrorResponse(
        err.toPublicCustomerError(requestId),
        err.statusCode
      );
    }

    const message =
      err instanceof Error ? redactSecrets(err.message) : 'Unexpected server failure during scan';
    const requestId = recordDiagnosticEvent({
      service: 'vision',
      category: 'temporary_service_failure',
      code: 'INTERNAL_SCAN_ERROR',
      statusCode: 503,
      severity: 'error',
      summary: message,
    });
    console.error(`[API /api/scan/analyze] [${requestId}] Unexpected Error:`, message);

    return makePublicErrorResponse(
      {
        error: 'structured_scan_error',
        request_id: requestId,
        error_category: 'temporary_service_failure',
        retryable: true,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'scan'),
      },
      503
    );
  }
}
