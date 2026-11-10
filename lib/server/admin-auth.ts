import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export interface AdminAuthResult {
  authorized: boolean;
  status: 200 | 401 | 403;
  adminEmail?: string;
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getAllowedAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes('@'))
  );
}

/**
 * Strictly verifies administrator authorization server-side before returning
 * internal diagnostics.
 * Accepts:
 *  1) Timing-safe `x-admin-secret` header matching server env `ADMIN_DIAGNOSTICS_SECRET` (>= 16 chars)
 *  2) Cryptographically verified Supabase Auth JWT (`Authorization: Bearer <token>`)
 *     whose verified account email is listed in server env `ADMIN_EMAILS`.
 * NEVER accepts client-supplied email claims, cookies without JWT verification, or unconfigured fallbacks.
 */
export async function verifyAdminRequest(req: NextRequest): Promise<AdminAuthResult> {
  const configuredSecret = (process.env.ADMIN_DIAGNOSTICS_SECRET || '').trim();
  const providedSecret = (req.headers.get('x-admin-secret') || '').trim();

  if (configuredSecret.length >= 16 && providedSecret.length > 0) {
    if (constantTimeEquals(providedSecret, configuredSecret)) {
      return { authorized: true, status: 200, adminEmail: 'admin-key-verified' };
    }
    return { authorized: false, status: 403 };
  }

  const authHeader = req.headers.get('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
  const accessToken = bearerMatch?.[1];

  if (!accessToken) {
    return { authorized: false, status: 401 };
  }

  const allowedAdmins = getAllowedAdminEmails();
  if (allowedAdmins.size === 0) {
    return { authorized: false, status: 403 };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { authorized: false, status: 403 };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user?.email) {
      return { authorized: false, status: 401 };
    }

    const email = data.user.email.trim().toLowerCase();
    const isVerified = Boolean(data.user.email_confirmed_at || data.user.confirmed_at);
    if (!isVerified || !allowedAdmins.has(email)) {
      return { authorized: false, status: 403 };
    }

    return { authorized: true, status: 200, adminEmail: email };
  } catch {
    return { authorized: false, status: 401 };
  }
}
