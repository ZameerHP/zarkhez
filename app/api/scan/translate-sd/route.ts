import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CropDiagnosisSchema } from '@/lib/schemas';
import { translateDiagnosisToSimpleSindhi } from '@/lib/gemini';

export const dynamic = 'force-dynamic';

const TranslateRequestSchema = z.object({
  diagnosis: CropDiagnosisSchema,
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request' },
      { status: 400, headers: { 'Cache-Control': 'no-store, private' } }
    );
  }

  const parsed = TranslateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_diagnosis_payload' },
      { status: 400, headers: { 'Cache-Control': 'no-store, private' } }
    );
  }

  try {
    const translated = await translateDiagnosisToSimpleSindhi(parsed.data.diagnosis);
    return NextResponse.json(
      { diagnosis: translated },
      { status: 200, headers: { 'Cache-Control': 'no-store, private' } }
    );
  } catch {
    return NextResponse.json(
      { diagnosis: parsed.data.diagnosis },
      { status: 200, headers: { 'Cache-Control': 'no-store, private' } }
    );
  }
}
