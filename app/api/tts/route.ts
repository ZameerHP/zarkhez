import { NextRequest, NextResponse } from 'next/server';

/**
 * Neural Human-Like Urdu & English Text-to-Speech API Route (/api/tts)
 * Streams natural, fluent Urdu (ur) and English (en) MP3 audio so every phone and PC
 * gets a clear, human-like Urdu voice even if the OS has no local ur-PK voice installed.
 */

// In-memory audio cache for instant playback on repeated phrases
const ttsMemoryCache = new Map<string, { buffer: Uint8Array; timestamp: number }>();

function splitIntoSpeakableChunks(text: string, maxLen = 85): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_~`>|[\]()]/g, ' ')
    .replace(/\bRs\.\s*/gi, 'روپے ')
    .replace(/\bPKR\b/gi, 'روپے ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  // Split by Urdu/English punctuation
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
  return chunks.slice(0, 8); // Keep concise for conversational fluency
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get('text') || '').trim().slice(0, 800);
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ur';

  if (!text) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const cacheKey = `${lang}:${text}`;
  const cached = ttsMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 3600_000) {
    return new Response(Buffer.from(cached.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }

  const chunks = splitIntoSpeakableChunks(text, 80);
  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Empty speakable text' }, { status: 400 });
  }

  try {
    const audioBuffers: ArrayBuffer[] = [];

    for (const chunk of chunks) {
      // Use client=gtx (ultra-reliable, high quality, no 429 blocks)
      const ttsUrl = new URL('https://translate.google.com/translate_tts');
      ttsUrl.searchParams.set('ie', 'UTF-8');
      ttsUrl.searchParams.set('tl', lang);
      ttsUrl.searchParams.set('client', 'gtx');
      ttsUrl.searchParams.set('q', chunk);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      try {
        const res = await fetch(ttsUrl.toString(), {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
            Accept: '*/*',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 64) {
            audioBuffers.push(buf);
          }
        }
      } catch {
        // Continue with other chunks if one fails
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

    // Concatenate MP3 chunks into single stream
    const totalLength = audioBuffers.reduce((acc, b) => acc + b.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of audioBuffers) {
      combined.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }

    // Cache in memory for instant reuse
    if (ttsMemoryCache.size > 200) {
      ttsMemoryCache.clear();
    }
    ttsMemoryCache.set(cacheKey, { buffer: combined, timestamp: Date.now() });

    return new Response(Buffer.from(combined), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to synthesize speech' },
      { status: 502 }
    );
  }
}
