import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export async function GET() {
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY
  );

  let fileHasKey = false;
  try {
    const envLocalPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envLocalPath)) {
      const content = fs.readFileSync(envLocalPath, 'utf8');
      fileHasKey = /^(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*AIza/m.test(content);
    }
  } catch {}

  return NextResponse.json({
    configured: hasKey || fileHasKey,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!apiKey || apiKey.length < 15) {
      return NextResponse.json(
        { error: 'Invalid Gemini API key. Keys typically start with AIza.' },
        { status: 400 }
      );
    }

    // Set in running Node.js process environment immediately
    process.env.GEMINI_API_KEY = apiKey;

    // Persist to .env.local
    const envLocalPath = path.resolve(process.cwd(), '.env.local');
    let content = '';
    if (fs.existsSync(envLocalPath)) {
      content = fs.readFileSync(envLocalPath, 'utf8');
    }

    if (/^GEMINI_API_KEY\s*=/m.test(content)) {
      content = content.replace(/^GEMINI_API_KEY\s*=.*$/m, `GEMINI_API_KEY=${apiKey}`);
    } else {
      content = `GEMINI_API_KEY=${apiKey}\n${content}`;
    }

    fs.writeFileSync(envLocalPath, content, 'utf8');

    return NextResponse.json({
      success: true,
      message: 'Gemini API Key configured and saved successfully.',
    });
  } catch (err) {
    console.error('Error saving Gemini API key:', err);
    return NextResponse.json(
      { error: 'Failed to save Gemini API key to .env.local' },
      { status: 500 }
    );
  }
}
