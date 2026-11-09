import { NextRequest, NextResponse } from 'next/server';
import { VerifyImageRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { verifyLeafImageWithVision } from '@/lib/anthropic';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again shortly.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = VerifyImageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Image must be base64 under ~1MB with crop name' },
      { status: 400 }
    );
  }

  const secondOpinion = await verifyLeafImageWithVision(
    parsed.data.image,
    parsed.data.crop,
    parsed.data.label
  );

  return NextResponse.json({ secondOpinion });
}
