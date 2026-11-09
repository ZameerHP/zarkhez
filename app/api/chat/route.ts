import { NextRequest, NextResponse } from 'next/server';
import { ChatRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import {
  generateFallbackChatReply,
  streamGeminiChatResponse,
} from '@/lib/gemini';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const rate = await checkRateLimit(ip);
  if (!rate.success) {
    return NextResponse.json(
      { error: 'Rate limit reached (max 20 AI calls per 10 min).' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid chat request input' },
      { status: 400 }
    );
  }

  const { messages, context, lang } = parsed.data;
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const encoder = new TextEncoder();

  if (!apiKey) {
    // Stream the fallback agricultural response smoothly word-by-word
    const reply = generateFallbackChatReply(lastUserMsg, lang, context);
    const words = reply.split(' ');
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? '' : ' ') + words[i];
          controller.enqueue(encoder.encode(chunk));
          await new Promise((r) => setTimeout(r, 16));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // Stream Gemini response word-by-word
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const fullReply = await streamGeminiChatResponse(
          messages,
          context
            ? {
                name: context.farmerName,
                farmerId: context.farmerId,
                district: context.region,
                crop: context.crop,
              }
            : undefined
        );

        const words = fullReply.split(' ');
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? '' : ' ') + words[i];
          controller.enqueue(encoder.encode(chunk));
          await new Promise((r) => setTimeout(r, 16));
        }
      } catch {
        const fallback = generateFallbackChatReply(lastUserMsg, lang, context);
        controller.enqueue(encoder.encode(fallback));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
