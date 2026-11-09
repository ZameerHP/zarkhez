import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ChatRequestSchema } from '@/lib/schemas';
import { checkRateLimit } from '@/lib/ratelimit';
import { CHAT_SYSTEM_PROMPT, generateFallbackChatReply } from '@/lib/anthropic';

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

  const contextBlock = [
    context?.crop ? `Crop: ${context.crop}` : 'Crop: general',
    context?.region ? `District/Region: ${context.region}` : 'District: Punjab',
    context?.stage ? `Stage: ${context.stage}` : '',
    context?.weatherSummary ? `Weather: ${context.weatherSummary}` : '',
    `Preferred language: ${lang === 'ur' ? 'Urdu (اردو)' : 'English'}`,
  ]
    .filter(Boolean)
    .join(' | ');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const encoder = new TextEncoder();

  if (!apiKey) {
    // Stream the fallback agricultural response smoothly word-by-word so streaming UI works identically
    const reply = generateFallbackChatReply(lastUserMsg, lang, context);
    const words = reply.split(' ');
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < words.length; i++) {
          const chunk = (i === 0 ? '' : ' ') + words[i];
          controller.enqueue(encoder.encode(chunk));
          await new Promise((r) => setTimeout(r, 18));
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

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const stream = new ReadableStream({
    async start(controller) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 20000);
      try {
        const anthropicStream = await client.messages.create(
          {
            model,
            max_tokens: 500,
            temperature: 0.3,
            system: `${CHAT_SYSTEM_PROMPT}\n\nCurrent Farmer Context: ${contextBlock}`,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
          },
          { signal: abortController.signal }
        );

        for await (const event of anthropicStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch {
        const fallback = generateFallbackChatReply(lastUserMsg, lang, context);
        controller.enqueue(encoder.encode(fallback));
      } finally {
        clearTimeout(timeout);
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
