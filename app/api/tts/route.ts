import { NextRequest, NextResponse } from 'next/server';

/**
 * Neural Human-Like Urdu & English Text-to-Speech API Route (/api/tts)
 * Streams natural, fluent Urdu (ur) and English (en) MP3 audio so every phone and PC
 * gets a clear, human-like Urdu voice even if the OS has no local ur-PK voice installed.
 */

function splitIntoSpeakableChunks(text: string, maxLen = 180): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_~`>|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  // Split by Urdu full stop (۔), English period, question mark, newline, or comma
  const sentences = cleaned.split(/(?<=[۔.!?،,\n])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length <= maxLen) {
      current = (current + ' ' + sentence).trim();
    } else {
      if (current) chunks.push(current);
      if (sentence.length <= maxLen) {
        current = sentence.trim();
      } else {
        // Hard-split very long clause by words
        const words = sentence.split(' ');
        let temp = '';
        for (const w of words) {
          if ((temp + ' ' + w).trim().length <= maxLen) {
            temp = (temp + ' ' + w).trim();
          } else {
            if (temp) chunks.push(temp);
            temp = w;
          }
        }
        current = temp;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get('text') || '').trim().slice(0, 1500);
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ur';

  if (!text) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const chunks = splitIntoSpeakableChunks(text, 185);
  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Empty speakable text' }, { status: 400 });
  }

  try {
    const audioBuffers: ArrayBuffer[] = [];

    for (const chunk of chunks) {
      const ttsUrl = new URL('https://translate.google.com/translate_tts');
      ttsUrl.searchParams.set('ie', 'UTF-8');
      ttsUrl.searchParams.set('tl', lang);
      ttsUrl.searchParams.set('client', 'tw-ob');
      ttsUrl.searchParams.set('q', chunk);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(ttsUrl.toString(), {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Referer: 'https://translate.google.com/',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 0) {
            audioBuffers.push(buf);
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (audioBuffers.length === 0) {
      return NextResponse.json(
        { error: 'TTS upstream unavailable' },
        { status: 502 }
      );
    }

    // Concatenate MP3 frames into a single smooth audio stream
    const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of audioBuffers) {
      combined.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }

    return new NextResponse(combined, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to synthesize neural speech' },
      { status: 502 }
    );
  }
}
