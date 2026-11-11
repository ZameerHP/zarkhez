import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/ratelimit';
import { getCustomerErrorMessage } from '@/lib/error-sanitizer';
import { recordDiagnosticEvent } from '@/lib/server/diagnostics-store';
import { submitQuarantinedFeedback } from '@/lib/vision/learning-store';

export const dynamic = 'force-dynamic';

const ScanFeedbackRequestSchema = z.object({
  scanId: z.string().min(2).max(120),
  modelVersion: z.string().min(2).max(80).default('zarkhez-vision-v2.4-cloud'),
  verdict: z.enum(['correct', 'incorrect', 'partial']),
  predictedCrop: z.string().min(1).max(80),
  predictedProblem: z.string().min(1).max(160),
  correctedCrop: z.string().max(80).optional(),
  correctedDisease: z.string().max(160).optional(),
  correctedSeverity: z.enum(['low', 'medium', 'high', 'not_assessed']).optional(),
  confirmedSource: z
    .enum(['farmer', 'extension_expert', 'laboratory_confirmed'])
    .optional()
    .default('farmer'),
  region: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  consentForDataset: z.boolean().optional().default(false),
  imageHash: z.string().max(64).optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    return NextResponse.json(
      { error: 'rate_limited', user_message: getCustomerErrorMessage('rate_limited', 'scan') },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = ScanFeedbackRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_feedback_payload' }, { status: 400 });
  }

  const { entry } = submitQuarantinedFeedback(parsed.data);

  recordDiagnosticEvent({
    service: 'vision',
    category: 'scan_feedback',
    code: `FEEDBACK_${parsed.data.verdict.toUpperCase()}`,
    statusCode: 200,
    severity: 'info',
    summary: `Quarantined ${parsed.data.verdict} feedback (${entry.feedbackId}) pending expert verification.`,
  });

  return NextResponse.json(
    {
      accepted: true,
      feedbackId: entry.feedbackId,
      quarantineStatus: entry.quarantineStatus,
      message: {
        en:
          parsed.data.verdict === 'correct'
            ? 'Thank you. Your scan feedback has been logged in our quarantined review queue.'
            : 'Thank you. Your correction has been placed in the expert verification queue and will NOT alter AI behavior until reviewed by an agricultural specialist.',
        ur:
          parsed.data.verdict === 'correct'
            ? 'شکریہ۔ آپ کی رائے ہمارے جائزہ ریکارڈ میں محفوظ کر لی گئی ہے۔'
            : 'شکریہ۔ آپ کی درستگی ماہرِ زراعت کے جائزے کے لیے محفوظ کر لی گئی ہے۔ ماہر کی تصدیق کے بغیر یہ خودکار تربیت میں شامل نہیں ہوگی۔',
      },
    },
    { status: 200, headers: { 'Cache-Control': 'no-store, private' } }
  );
}
