import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/ratelimit';
import { verifyAdminRequest } from '@/lib/server/admin-auth';
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
 * Automated daily Vercel Cron entrypoint (`GET`) + manual admin fallback.
 */
export async function GET(req: NextRequest) {
  const cronOk = isAuthorizedCronRequest(req);
  if (!cronOk) {
    const adminAuth = await verifyAdminRequest(req);
    if (!adminAuth.authorized) {
      return NextResponse.json(
        { error: 'Unauthorized schemes refresh access required.' },
        {
          status: adminAuth.status,
          headers: { 'Cache-Control': 'no-store, private' },
        }
      );
    }
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

/**
 * Manual admin-triggered live check of official portals.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAdminRequest(req);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: 'Unauthorized administrator access required.' },
      {
        status: auth.status,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }

  const forwarded = req.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0]?.trim() || 'admin-schemes-refresh';
  const rl = await checkRateLimit(`schemes-refresh:${ip}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many refresh requests. Please wait a few minutes.' },
      {
        status: 429,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }

  try {
    const result = await refreshSchemesFromPortals({ force: true });
    return NextResponse.json(
      {
        ok: true,
        authorizedAdmin: auth.adminEmail,
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
