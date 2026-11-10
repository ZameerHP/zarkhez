import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest } from '@/lib/server/admin-auth';
import { getInternalDiagnosticsSnapshot } from '@/lib/server/diagnostics-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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

  const snapshot = getInternalDiagnosticsSnapshot();
  return NextResponse.json(
    {
      authorizedAdmin: auth.adminEmail,
      ...snapshot,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store, private' },
    }
  );
}
