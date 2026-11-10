import { NextRequest, NextResponse } from 'next/server';
import { GeocodeQuerySchema } from '@/lib/schemas';
import { searchOpenMeteoPlaces } from '@/lib/weather';
import { redactSecrets } from '@/lib/error-sanitizer';
import {
  recordDiagnosticEvent,
  recordDiagnosticSuccess,
} from '@/lib/server/diagnostics-store';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

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
      {
        error: 'invalid_query',
        user_message: {
          en: 'Please type at least 2 letters of your city or district name.',
          ur: 'براہِ کرم شہر یا ضلع کے نام کے کم از کم 2 حروف لکھیں۔',
        },
      },
      { status: 400 }
    );
  }

  try {
    const places = await searchOpenMeteoPlaces(parsed.data.q);
    recordDiagnosticSuccess('geocode');
    return NextResponse.json({ places });
  } catch (err) {
    recordDiagnosticEvent({
      service: 'geocode',
      category: 'temporary_service_failure',
      code: 'GEOCODE_LOOKUP_FAILED',
      statusCode: 200,
      severity: 'warn',
      summary: err instanceof Error ? redactSecrets(err.message) : 'Geocode upstream error',
    });
    return NextResponse.json({ places: [] }, { status: 200 });
  }
}
