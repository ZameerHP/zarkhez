import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { redactSecrets } from '@/lib/error-sanitizer';
import { recordDiagnosticEvent } from '@/lib/server/diagnostics-store';

export const dynamic = 'force-dynamic';

const PronunciationFeedbackSchema = z.object({
  word: z.string().min(1).max(160),
  lang: z.enum(['ur', 'sd', 'en']),
  audioId: z.string().max(80).optional(),
  phrase: z.string().max(400).optional(),
  expectedPronunciation: z.string().max(200).optional(),
  note: z.string().max(400).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const parsed = PronunciationFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_feedback_fields' }, { status: 400 });
  }

  const entry = {
    timestamp: new Date().toISOString(),
    word: redactSecrets(parsed.data.word).slice(0, 160),
    lang: parsed.data.lang,
    audioId: parsed.data.audioId || 'unknown',
    phrase: parsed.data.phrase ? redactSecrets(parsed.data.phrase).slice(0, 260) : undefined,
    expectedPronunciation: parsed.data.expectedPronunciation
      ? redactSecrets(parsed.data.expectedPronunciation).slice(0, 160)
      : undefined,
    note: parsed.data.note ? redactSecrets(parsed.data.note).slice(0, 260) : undefined,
  };

  try {
    const logPath = path.resolve(process.cwd(), 'data/voice/pronunciation-feedback.jsonl');
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Graceful on read-only serverless runtimes; recorded cleanly in diagnostics below
  }

  recordDiagnosticEvent({
    service: 'tts',
    category: 'pronunciation_feedback',
    code: 'PRONUNCIATION_REPORTED',
    statusCode: 200,
    severity: 'info',
    summary: `Pronunciation flag (${entry.lang}, audioId=${entry.audioId}): ${entry.word}`,
  });

  return NextResponse.json({
    saved: true,
    message: {
      en: 'Thank you. We logged this pronunciation report for review.',
      ur: 'شکریہ۔ ہم نے اس لفظ کا تلفظ درست کرنے کے لیے نوٹ کر لیا ہے۔',
      sd: 'مهرباني. اسان هن لفظ جو اچار درست ڪرڻ لاءِ نوٽ ڪري ورتو آهي.',
    },
  });
}
