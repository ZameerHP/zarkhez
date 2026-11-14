import { NextResponse } from 'next/server';
import {
  isSchemesStateStale,
  loadSchemesCatalogServer,
  refreshSchemesFromPortals,
} from '@/lib/server/schemes-store';

export const dynamic = 'force-dynamic';

/**
 * Fully automatic schemes endpoint:
 * - Applies Pakistan-timezone expiry rules immediately on every read
 * - On cold uninitialized cache (`lastAutoCheckAt === null`), waits briefly (up to 2.5s)
 *   for fresh discovery + updates before falling back to bundled catalog cleanly
 * - Otherwise triggers background portal refresh when older than 6 hours
 */
export async function GET() {
  try {
    let catalog = await loadSchemesCatalogServer();

    if (!catalog.lastAutoCheckAt) {
      await Promise.race([
        refreshSchemesFromPortals({ force: true })
          .then((fresh) => {
            catalog = {
              schemes: fresh.schemes,
              lastAutoCheckAt: fresh.lastAutoCheckAt,
              source: fresh.source,
            };
          })
          .catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ]);
    } else if (isSchemesStateStale(catalog.lastAutoCheckAt)) {
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
