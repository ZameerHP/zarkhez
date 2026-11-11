import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdminRequest } from '@/lib/server/admin-auth';
import {
  getContinuousLearningSummary,
  verifyAndPromoteFeedback,
} from '@/lib/vision/learning-store';

export const dynamic = 'force-dynamic';

const ExpertVerificationSchema = z.object({
  feedbackId: z.string().min(4).max(80),
  decision: z.enum(['approve', 'reject']),
  verifiedCrop: z.string().min(1).max(80),
  verifiedDisease: z.string().min(1).max(160),
  verifiedSeverity: z.enum(['low', 'medium', 'high', 'not_assessed']),
  confirmationLevel: z
    .enum(['extension_expert', 'laboratory_confirmed'])
    .optional()
    .default('extension_expert'),
});

export async function GET(req: NextRequest) {
  const auth = await verifyAdminRequest(req);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: 'Unauthorized agricultural expert access required.' },
      { status: auth.status, headers: { 'Cache-Control': 'no-store, private' } }
    );
  }

  return NextResponse.json(
    {
      authorizedReviewer: auth.adminEmail,
      ...getContinuousLearningSummary(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store, private' } }
  );
}

export async function POST(req: NextRequest) {
  const auth = await verifyAdminRequest(req);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: 'Unauthorized agricultural expert access required.' },
      { status: auth.status, headers: { 'Cache-Control': 'no-store, private' } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = ExpertVerificationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_verification_payload' }, { status: 400 });
  }

  const res = verifyAndPromoteFeedback({
    ...parsed.data,
    verifiedBy: auth.adminEmail || 'authorized-expert',
  });

  if (!res.ok) {
    return NextResponse.json({ verified: false, reason: res.reason }, { status: 400 });
  }

  return NextResponse.json(
    {
      verified: true,
      promotedRecord: res.promotedRecord,
      reason: res.reason,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store, private' } }
  );
}
