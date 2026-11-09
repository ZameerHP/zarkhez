import { NextRequest, NextResponse } from 'next/server';
import { CropAnalysisRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { analyzeCropImageWithGemini } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    return NextResponse.json(
      { error: 'Too many scan requests. Please wait a moment.' },
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

  const { image, selectedCrop, confirmMismatchOverride } = parsed.data;

  try {
    const diagnosis = await analyzeCropImageWithGemini(
      image,
      selectedCrop,
      confirmMismatchOverride
    );

    return NextResponse.json(diagnosis, { status: 200 });
  } catch (err) {
    console.error('Scan analyze error:', err);
    return NextResponse.json(
      { error: 'Failed to analyze crop image. Please retry.' },
      { status: 500 }
    );
  }
}
