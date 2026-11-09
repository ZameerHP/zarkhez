import { NextRequest, NextResponse } from 'next/server';
import { GeocodeQuerySchema } from '@/lib/schemas';
import { searchOpenMeteoPlaces } from '@/lib/weather';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
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
