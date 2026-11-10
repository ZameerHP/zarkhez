import { NextRequest, NextResponse } from 'next/server';
import { CropAnalysisRequestSchema, StructuredScanError } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { analyzeCropImageWithGemini, GeminiVisionError } from '@/lib/gemini';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function makeStructuredErrorResponse(
  payload: StructuredScanError,
  status: number
): NextResponse {
  return NextResponse.json(payload, { status });
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    return makeStructuredErrorResponse(
      {
        error: 'structured_scan_error',
        error_category: 'rate_limited',
        code: 'RATE_LIMITED',
        retryable: true,
        user_message: {
          en: 'Too many scan requests right now. Please wait 30 seconds and try again.',
          ur: 'اس وقت بہت زیادہ اسکین درخواستیں آ رہی ہیں۔ براہِ کرم 30 سیکنڈ انتظار کر کے دوبارہ کوشش کریں۔',
        },
        technical_summary: 'Client IP exceeded sliding-window scan rate limit (429).',
      },
      429
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return makeStructuredErrorResponse(
      {
        error: 'structured_scan_error',
        error_category: 'invalid_image_input',
        code: 'INVALID_REQUEST_JSON',
        retryable: false,
        user_message: {
          en: 'Invalid scan upload format. Please re-select your photo and try again.',
          ur: 'تصویر بھیجنے کا فارمیٹ درست نہیں۔ براہِ کرم تصویر دوبارہ منتخب کر کے کوشش کریں۔',
        },
        technical_summary: 'Request body could not be parsed as JSON.',
      },
      400
    );
  }

  const parsed = CropAnalysisRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.issues.map((iss) => ({
      path: iss.path.map(String).join('.') || '(body)',
      code: iss.code,
      message: iss.message,
    }));

    return makeStructuredErrorResponse(
      {
        error: 'structured_scan_error',
        error_category: 'invalid_image_input',
        code: 'INVALID_SCAN_PAYLOAD',
        retryable: false,
        user_message: {
          en: 'The uploaded photo could not be accepted (missing data or file too large). Please take a clearer standard photo.',
          ur: 'اپلوڈ کی گئی تصویر قابل قبول نہیں (فائل خالی یا سائز بہت بڑا ہے)۔ براہِ کرم عام سائز کی نئی تصویر لیں۔',
        },
        technical_summary: 'Request payload failed CropAnalysisRequestSchema validation.',
        field_errors: fieldErrors,
      },
      400
    );
  }

  const { image, selectedCrop, confirmMismatchOverride, clientQuality } = parsed.data;

  try {
    const diagnosis = await analyzeCropImageWithGemini(
      image,
      selectedCrop,
      confirmMismatchOverride,
      clientQuality
    );

    return NextResponse.json(diagnosis, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof GeminiVisionError) {
      console.error(
        `[API /api/scan/analyze] Classified Error [${err.code} / ${err.errorCategory}]:`,
        err.message
      );
      return makeStructuredErrorResponse(err.toStructuredError(), err.statusCode);
    }

    const message = err instanceof Error ? err.message : 'Unexpected server failure during scan';
    console.error('[API /api/scan/analyze] Unexpected Error:', message);

    return makeStructuredErrorResponse(
      {
        error: 'structured_scan_error',
        error_category: 'temporary_service_failure',
        code: 'INTERNAL_SCAN_ERROR',
        retryable: true,
        user_message: {
          en: 'Unexpected temporary error while inspecting your plant photo. Your photo is preserved — tap Retry.',
          ur: 'معائنے کے دوران عارضی تکنیکی خرابی پیش آئی ہے۔ آپ کی تصویر محفوظ ہے — براہِ کرم دوبارہ کوشش کریں۔',
        },
        technical_summary: message.slice(0, 300),
      },
      503
    );
  }
}
