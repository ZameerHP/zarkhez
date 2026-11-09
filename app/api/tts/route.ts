import { NextRequest, NextResponse } from 'next/server';

/**
 * Neural Human-Like Urdu & English Text-to-Speech API Route (/api/tts)
 * Supports:
 * 1. Microsoft Azure Speech (ur-PK-UzmaNeural / ur-PK-AsadNeural) when key is configured
 * 2. High-speed parallel Google Neural/GTX fallback (ultra-reliable, 0 configuration, works everywhere)
 */

const ttsMemoryCache = new Map<string, { buffer: Uint8Array; timestamp: number }>();

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_~`>|[\]()•]/g, ' ')
    .replace(/\bRs\.\s*/gi, 'روپے ')
    .replace(/\bPKR\b/gi, 'روپے ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoSpeakableChunks(text: string, maxLen = 120): string[] {
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return [];

  // Split by sentence delimiters
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
  return chunks.slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const text = (searchParams.get('text') || '').trim().slice(0, 900);
  const lang = searchParams.get('lang') === 'en' ? 'en' : 'ur';
  const voice = searchParams.get('voice') || (lang === 'ur' ? 'ur-PK-UzmaNeural' : 'en-US-JennyNeural');

  if (!text) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const cacheKey = `${lang}:${voice}:${text}`;
  const cached = ttsMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 86400_000) {
    return new Response(Buffer.from(cached.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  }

  // 1. Try Azure Speech Service if key is provided
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';

  if (azureKey) {
    try {
      const azureUrl = `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = `<speak version='1.0' xml:lang='${lang === 'ur' ? 'ur-PK' : 'en-US'}'>
        <voice xml:lang='${lang === 'ur' ? 'ur-PK' : 'en-US'}' name='${voice}'>
          ${escapeXml(cleanTextForSpeech(text))}
        </voice>
      </speak>`;

      const res = await fetch(azureUrl, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          'User-Agent': 'Zarkhez-TTS',
        },
        body: ssml,
      });

      if (res.ok) {
        const audioBuf = await res.arrayBuffer();
        const uint8 = new Uint8Array(audioBuf);
        ttsMemoryCache.set(cacheKey, { buffer: uint8, timestamp: Date.now() });

        return new Response(Buffer.from(uint8), {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    } catch (azureErr) {
      console.warn('[Azure TTS] Fallback to fast parallel engine:', azureErr);
    }
  }

  // 2. High-speed Parallel Google Voice Stream (Fast, Warm, Ultra-Reliable)
  const chunks = splitIntoSpeakableChunks(text, 100);
  if (chunks.length === 0) {
    return NextResponse.json({ error: 'Empty text' }, { status: 400 });
  }

  try {
    const chunkPromises = chunks.map(async (chunk) => {
      const ttsUrl = new URL('https://translate.google.com/translate_tts');
      ttsUrl.searchParams.set('ie', 'UTF-8');
      ttsUrl.searchParams.set('tl', lang);
      ttsUrl.searchParams.set('client', 'gtx');
      ttsUrl.searchParams.set('q', chunk);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);

      try {
        const res = await fetch(ttsUrl.toString(), {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
            Accept: '*/*',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 64) {
            return buf;
          }
        }
      } catch {
        // ignore chunk error
      } finally {
        clearTimeout(timeout);
      }
      return null;
    });

    const buffers = (await Promise.all(chunkPromises)).filter(
      (b): b is ArrayBuffer => b !== null
    );

    if (buffers.length === 0) {
      return NextResponse.json(
        { error: 'TTS upstream unavailable' },
        { status: 502 }
      );
    }

    const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of buffers) {
      combined.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }

    if (ttsMemoryCache.size > 250) {
      ttsMemoryCache.clear();
    }
    ttsMemoryCache.set(cacheKey, { buffer: combined, timestamp: Date.now() });

    return new Response(Buffer.from(combined), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      },
    });
  } catch (err) {
    console.error('[TTS API error]:', err);
    return NextResponse.json(
      { error: 'Failed to synthesize speech' },
      { status: 502 }
    );
  }
}
