import { NextRequest, NextResponse } from 'next/server';
import { WeatherQuerySchema } from '@/lib/schemas';
import { fetchOpenMeteoForecast } from '@/lib/weather';
import { getCustomerErrorMessage, redactSecrets } from '@/lib/error-sanitizer';
import {
  recordDiagnosticEvent,
  recordDiagnosticSuccess,
} from '@/lib/server/diagnostics-store';

export const revalidate = 1800;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = WeatherQuerySchema.safeParse({
    lat: searchParams.get('lat'),
    lon: searchParams.get('lon'),
  });

  if (!parsed.success) {
    const requestId = recordDiagnosticEvent({
      service: 'weather',
      category: 'invalid_image_input',
      code: 'INVALID_COORDINATES',
      statusCode: 400,
      severity: 'warn',
      summary: 'Weather request had invalid latitude/longitude parameters.',
    });
    return NextResponse.json(
      {
        error: 'weather_unavailable',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'weather'),
      },
      { status: 400 }
    );
  }

  try {
    const forecast = await fetchOpenMeteoForecast(
      parsed.data.lat,
      parsed.data.lon
    );
    recordDiagnosticSuccess('weather');
    return NextResponse.json(forecast);
  } catch (err) {
    const requestId = recordDiagnosticEvent({
      service: 'weather',
      category: 'temporary_service_failure',
      code: 'WEATHER_UPSTREAM_FAILED',
      statusCode: 502,
      severity: 'error',
      summary: err instanceof Error ? redactSecrets(err.message) : 'Weather forecast fetch failed',
    });
    return NextResponse.json(
      {
        error: 'weather_unavailable',
        request_id: requestId,
        user_message: getCustomerErrorMessage('temporary_service_failure', 'weather'),
      },
      { status: 502 }
    );
  }
}
