import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAdminRequest } from '@/lib/server/admin-auth';
import {
  adminUpdateSchemeServer,
  isSchemesStateStale,
  loadSchemesCatalogServer,
  refreshSchemesFromPortals,
} from '@/lib/server/schemes-store';
import { isValidIsoDateString } from '@/lib/schemes';

export const dynamic = 'force-dynamic';

const AdminSchemePatchSchema = z.object({
  id: z.string().min(1).max(100),
  status: z.enum(['ongoing', 'verify_on_portal', 'expired']),
  expiresAt: z
    .string()
    .nullable()
    .optional()
    .refine((val) => val === undefined || val === null || val === '' || isValidIsoDateString(val), {
      message: 'expiresAt must be a valid YYYY-MM-DD date.',
    }),
  datesNote: z
    .object({
      en: z.string().min(1).max(300),
      ur: z.string().min(1).max(300),
    })
    .optional(),
  verifiedBy: z.string().min(1).max(120).optional(),
});

export async function GET() {
  try {
    const catalog = await loadSchemesCatalogServer();

    if (isSchemesStateStale(catalog.lastAutoCheckAt)) {
      void refreshSchemesFromPortals().catch(() => undefined);
    }

    return NextResponse.json(catalog, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load government schemes catalog.' },
      { status: 500 }
    );
  }
}

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON request payload.' },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }

  const parsed = AdminSchemePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid scheme update fields provided.' },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }

  try {
    const updated = await adminUpdateSchemeServer(parsed.data);
    return NextResponse.json(
      {
        ok: true,
        authorizedAdmin: auth.adminEmail,
        ...updated,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to update scheme.';
    const status = msg.startsWith('Unknown scheme') ? 404 : 400;
    return NextResponse.json(
      { error: msg },
      {
        status,
        headers: { 'Cache-Control': 'no-store, private' },
      }
    );
  }
}
