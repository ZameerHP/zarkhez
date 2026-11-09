import { NextRequest, NextResponse } from 'next/server';
import { GeocodeQuerySchema } from '@/lib/schemas';
import { searchOpenMeteoPlaces } from '@/lib/weather';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Auto-detect real location from Vercel / Cloudflare edge headers
  if (searchParams.get('detect') === '1') {
    const vercelCity = req.headers.get('x-vercel-ip-city');
    const vercelRegion = req.headers.get('x-vercel-ip-country-region') || 'Pakistan';
    const vercelLat = parseFloat(req.headers.get('x-vercel-ip-latitude') || '');
    const vercelLon = parseFloat(req.headers.get('x-vercel-ip-longitude') || '');

    if (vercelCity && !Number.isNaN(vercelLat) && !Number.isNaN(vercelLon)) {
      return NextResponse.json({
        detected: true,
        city: decodeURIComponent(vercelCity),
        region: decodeURIComponent(vercelRegion),
        placeName: `${decodeURIComponent(vercelCity)}, ${decodeURIComponent(vercelRegion)}`,
        lat: vercelLat,
        lon: vercelLon,
      });
    }

    return NextResponse.json({
      detected: false,
      city: 'Faisalabad',
      region: 'Punjab',
      placeName: 'Faisalabad, Punjab',
      lat: 31.418,
      lon: 73.079,
    });
  }

  const parsed = GeocodeQuerySchema.safeParse({
    q: searchParams.get('q') || '',
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Search query must be at least 2 characters' },
      { status: 400 }
    );
  }

  try {
    const places = await searchOpenMeteoPlaces(parsed.data.q);
    return NextResponse.json({ places });
  } catch {
    return NextResponse.json({ places: [] }, { status: 200 });
  }
}
