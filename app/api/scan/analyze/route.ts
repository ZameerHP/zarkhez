import { NextRequest, NextResponse } from 'next/server';
import { CropAnalysisRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { analyzeCropImageWithGemini, GeminiVisionError } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    return NextResponse.json(
      {
        error: 'Too many scan requests. Please wait a moment.',
        code: 'RATE_LIMITED',
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CropAnalysisRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid crop scan payload', details: parsed.error.format() },
      { status: 400 }
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
    console.error('[API /api/scan/analyze] Vision Analysis Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to analyze crop image';
    const statusCode = err instanceof GeminiVisionError ? err.statusCode : 503;
    const errorCode = err instanceof GeminiVisionError ? err.code : 'GEMINI_VISION_ERROR';

    return NextResponse.json(
      {
        error: 'gemini_vision_unavailable',
        code: errorCode,
        message,
        details: 'Gemini Multimodal Cloud Vision inspection could not complete. Your photo is preserved for retry.',
      },
      { status: statusCode }
    );
  }
}
