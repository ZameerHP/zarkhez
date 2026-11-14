import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { refreshSchemesFromPortals } from '@/lib/server/schemes-store';

export const dynamic = 'force-dynamic';

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const configuredSecret = (process.env.CRON_SECRET || '').trim();
  if (configuredSecret.length < 16) return false;

  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const providedToken = match?.[1]?.trim() || '';
  if (!providedToken) return false;

  return constantTimeEquals(providedToken, configuredSecret);
}

/**
 * Automated daily Vercel Cron entrypoint (`GET /api/schemes/refresh`).
 * Runs purely automatically without any Admin UI or manual intervention.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { error: 'Unauthorized automated refresh request.' },
      {
        status: 401,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }

  try {
    const result = await refreshSchemesFromPortals({ force: true });
    return NextResponse.json(
      {
        ok: true,
        ...result,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Automated schemes check failed.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }
}
