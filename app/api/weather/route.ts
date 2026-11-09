import { NextRequest, NextResponse } from 'next/server';
import { WeatherQuerySchema } from '@/lib/schemas';
import { fetchOpenMeteoForecast } from '@/lib/weather';

export const revalidate = 1800;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parsed = WeatherQuerySchema.safeParse({
    lat: searchParams.get('lat'),
    lon: searchParams.get('lon'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid latitude or longitude parameters' },
      { status: 400 }
    );
  }

  try {
    const forecast = await fetchOpenMeteoForecast(
      parsed.data.lat,
      parsed.data.lon
    );
    return NextResponse.json(forecast);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Failed to fetch weather forecast',
      },
      { status: 502 }
    );
  }
}
