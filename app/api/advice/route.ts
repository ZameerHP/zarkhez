import { NextRequest, NextResponse } from 'next/server';
import { AdviceRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { generateCropAdvice } from '@/lib/gemini';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AdviceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid advice request payload' },
      { status: 400 }
    );
  }

  const { label, confidence, crop, image } = parsed.data;
  const result = await generateCropAdvice(label, confidence, crop, image);

  return NextResponse.json(result);
}
