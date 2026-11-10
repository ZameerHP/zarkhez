import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  redactSecrets,
  containsTechnicalLeak,
  getCustomerErrorMessage,
  sanitizeCustomerText,
} from '../lib/error-sanitizer';
import {
  clearInternalDiagnosticsForTests,
  getInternalDiagnosticsSnapshot,
  recordDiagnosticEvent,
} from '../lib/server/diagnostics-store';
import { GET as adminDiagnosticsGet } from '../app/api/admin/diagnostics/route';
import { POST as analyzeRoutePost } from '../app/api/scan/analyze/route';
import { GET as weatherRouteGet } from '../app/api/weather/route';
import { POST as adviceRoutePost } from '../app/api/advice/route';
import { POST as chatRoutePost } from '../app/api/chat/route';
import { POST as verifyRoutePost } from '../app/api/verify-image/route';
import { GET as ttsRouteGet } from '../app/api/tts/route';

const MOCK_GOOGLE_SECRET = 'AIzaSySimulatedSecretLeakTest999888777';
const MOCK_ANTHROPIC_SECRET = 'sk-ant-api03-SimulatedAnthropicSecretKey123456';
const MOCK_JWT_SECRET = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiJ9.signaturepart';
const SAMPLE_IMAGE_B64 =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

function collectFilesRecursive(dir: string, exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs']): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function testCase(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  PASS: ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL: ${name}`);
      console.error(err);
    }
  }

  console.log('\n=== Zarkhez Security & Zero-Leak Protection Suite ===\n');

  await testCase('1. No NEXT_PUBLIC_ secret environment variables exist anywhere in source', () => {
    const allFiles = [
      ...collectFilesRecursive(path.resolve('app')),
      ...collectFilesRecursive(path.resolve('components')),
      ...collectFilesRecursive(path.resolve('lib')),
      path.resolve('next.config.mjs'),
      path.resolve('.env.example'),
    ].filter((f) => fs.existsSync(f));

    const forbiddenPublicSecretPattern =
      /NEXT_PUBLIC_(?:GEMINI|GOOGLE_API|AZURE_SPEECH|SUPABASE_SERVICE_ROLE|ANTHROPIC|RESEND|UPSTASH_REDIS_REST_TOKEN|ADMIN_DIAGNOSTICS|DB_PASSWORD|WEBHOOK_SECRET|PRIVATE)/;

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf8');
      assert.equal(
        forbiddenPublicSecretPattern.test(content),
        false,
        `Forbidden NEXT_PUBLIC_ secret pattern found in ${file}`
      );
    }
  });

  await testCase('2. Client components never import server-only AI, env, or admin diagnostics modules', () => {
    const frontendFiles = [
      ...collectFilesRecursive(path.resolve('components')),
      ...collectFilesRecursive(path.resolve('app/[locale]')),
    ];

    const forbiddenImports = [
      /@\/lib\/gemini/,
      /@\/lib\/anthropic/,
      /@\/lib\/error-sanitizer/,
      /@\/lib\/server\//,
      /process\.env\.GEMINI_API_KEY/,
      /process\.env\.AZURE_SPEECH_KEY/,
      /process\.env\.SUPABASE_SERVICE_ROLE_KEY/,
      /process\.env\.ADMIN_DIAGNOSTICS_SECRET/,
    ];

    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const rx of forbiddenImports) {
        assert.equal(rx.test(content), false, `Forbidden client reference ${rx} found in ${file}`);
      }
    }
  });

  await testCase('3. Global and locale error boundaries exist and never display raw error objects', () => {
    const rootBoundary = fs.readFileSync(path.resolve('app/global-error.tsx'), 'utf8');
    const localeBoundary = fs.readFileSync(path.resolve('app/[locale]/error.tsx'), 'utf8');
    for (const [label, src] of [
      ['app/global-error.tsx', rootBoundary],
      ['app/[locale]/error.tsx', localeBoundary],
    ]) {
      assert.ok(!src.includes('error.message'), `${label} must never render error.message`);
      assert.ok(!src.includes('error.stack'), `${label} must never render error.stack`);
      assert.ok(!src.includes('error.digest'), `${label} must never render error.digest`);
    }
  });

  await testCase('4. Customer UI files contain zero technical error panels, Zod jargon, or provider branding', () => {
    const customerFiles = [
      ...collectFilesRecursive(path.resolve('components')),
      ...collectFilesRecursive(path.resolve('app/[locale]')).filter(
        (f) => !f.includes(`${path.sep}admin${path.sep}`) && !f.endsWith(`${path.sep}admin${path.sep}page.tsx`)
      ),
    ];

    const forbiddenCustomerText = [
      /showDevDiagnostics/,
      /technical_summary/,
      /field_errors/,
      /Technical Details/,
      /Zod validation/i,
      /ZodError/,
    ];

    for (const file of customerFiles) {
      const content = fs.readFileSync(file, 'utf8');
      for (const rx of forbiddenCustomerText) {
        assert.equal(rx.test(content), false, `Technical leak pattern ${rx} found in ${file}`);
      }
    }
  });

  await testCase('5. Next.js security headers, disabled client source maps, and SW API bypass are configured', () => {
    const nextCfg = fs.readFileSync(path.resolve('next.config.mjs'), 'utf8');
    const swSrc = fs.readFileSync(path.resolve('public/sw.js'), 'utf8');
    const middlewareSrc = fs.readFileSync(path.resolve('middleware.ts'), 'utf8');

    assert.ok(nextCfg.includes('poweredByHeader: false'));
    assert.ok(nextCfg.includes('productionBrowserSourceMaps: false'));
    assert.ok(nextCfg.includes('no-store, private'));
    assert.ok(swSrc.includes("url.pathname.startsWith('/api/')"));
    assert.ok(swSrc.includes("url.pathname.includes('/admin')"));
    assert.ok(middlewareSrc.includes("'/admin'"));
  });

  await testCase('6. redactSecrets strips Google, Anthropic, JWT, header, and Postgres credentials', () => {
    const dirty = [
      `Error calling x-goog-api-key=${MOCK_GOOGLE_SECRET}`,
      `anthropic=${MOCK_ANTHROPIC_SECRET}`,
      `Authorization: Bearer ${MOCK_JWT_SECRET}`,
      `Ocp-Apim-Subscription-Key: myazuresecret123456`,
      `postgres://postgres:supersecretpw@db.supabase.co:5432/postgres`,
    ].join(' | ');

    const cleaned = redactSecrets(dirty);
    assert.equal(cleaned.includes(MOCK_GOOGLE_SECRET), false);
    assert.equal(cleaned.includes(MOCK_ANTHROPIC_SECRET), false);
    assert.equal(cleaned.includes(MOCK_JWT_SECRET), false);
    assert.equal(cleaned.includes('myazuresecret123456'), false);
    assert.equal(cleaned.includes('supersecretpw'), false);
    assert.ok(cleaned.includes('[REDACTED'));
  });

  await testCase('7. containsTechnicalLeak catches stacks, HTTP codes, Zod, SQL, and env vars while allowing clean Urdu/English', () => {
    assert.equal(containsTechnicalLeak('ZodError: invalid_type at path problem_name'), true);
    assert.equal(containsTechnicalLeak('Request failed with HTTP 429 from upstream'), true);
    assert.equal(containsTechnicalLeak(`Invalid key ${MOCK_GOOGLE_SECRET}`), true);
    assert.equal(containsTechnicalLeak('postgrest error relation scans violates row-level security'), true);
    assert.equal(containsTechnicalLeak('    at Object.<anonymous> (app/api/scan/analyze/route.ts:45:10)'), true);

    const safeScanMsg = getCustomerErrorMessage('temporary_service_failure', 'scan');
    assert.equal(containsTechnicalLeak(safeScanMsg.ur), false);
    assert.equal(containsTechnicalLeak(safeScanMsg.en), false);
    assert.equal(sanitizeCustomerText('Unexpected token < in JSON at position 0', 'ur'), safeScanMsg.ur);
  });

  await testCase('8. /api/scan/analyze never exposes secrets, Zod fields, or technical summaries on upstream 401/429 failure', async () => {
    clearInternalDiagnosticsForTests();
    const origFetch = globalThis.fetch;
    const origKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = MOCK_GOOGLE_SECRET;

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 401,
            message: `API key not valid: ${MOCK_GOOGLE_SECRET} for GEMINI_API_KEY`,
          },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      )) as typeof fetch;

    try {
      const req = new NextRequest('http://localhost/api/scan/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.99.0.1' },
        body: JSON.stringify({ image: SAMPLE_IMAGE_B64, selectedCrop: 'wheat' }),
      });

      const res = await analyzeRoutePost(req);
      assert.ok(res.status >= 400);
      assert.ok((res.headers.get('cache-control') || '').includes('no-store'));

      const bodyText = await res.text();
      assert.equal(bodyText.includes(MOCK_GOOGLE_SECRET), false);
      assert.equal(bodyText.includes('GEMINI_API_KEY'), false);
      assert.equal(bodyText.includes('technical_summary'), false);
      assert.equal(bodyText.includes('field_errors'), false);

      const json = JSON.parse(bodyText);
      assert.equal(json.error, 'structured_scan_error');
      assert.equal(json.error_category, 'permanent_config_error');
      assert.equal(json.code, undefined);
      assert.equal(containsTechnicalLeak(json.user_message.ur), false);
      assert.equal(containsTechnicalLeak(json.user_message.en), false);

      const snapshot = getInternalDiagnosticsSnapshot();
      assert.ok(snapshot.recentEvents.length > 0);
      assert.equal(JSON.stringify(snapshot).includes(MOCK_GOOGLE_SECRET), false);
    } finally {
      globalThis.fetch = origFetch;
      if (origKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origKey;
    }
  });

  await testCase('9. /api/advice, /api/chat, and /api/verify-image strip secrets and technical messages on failure', async () => {
    const origFetch = globalThis.fetch;
    const origKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = MOCK_GOOGLE_SECRET;

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: `Quota exhausted with ${MOCK_GOOGLE_SECRET} on generativelanguage.googleapis.com`,
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )) as typeof fetch;

    try {
      const adviceReq = new NextRequest('http://localhost/api/advice', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.99.0.2' },
        body: JSON.stringify({ label: 'leaf_rust', confidence: 0.9, crop: 'wheat' }),
      });
      const adviceRes = await adviceRoutePost(adviceReq);
      const adviceText = await adviceRes.text();
      assert.equal(adviceText.includes(MOCK_GOOGLE_SECRET), false);
      assert.equal(adviceText.includes('generativelanguage'), false);
      assert.equal(adviceText.includes('429'), false);

      const chatReq = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.99.0.3' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'گندم میں زرد کنگی کا علاج؟' }],
          lang: 'ur',
        }),
      });
      const chatRes = await chatRoutePost(chatReq);
      const chatText = await chatRes.text();
      assert.equal(chatText.includes(MOCK_GOOGLE_SECRET), false);
      assert.equal(chatText.includes('generativelanguage'), false);

      const verifyReq = new NextRequest('http://localhost/api/verify-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.99.0.4' },
        body: JSON.stringify({ image: SAMPLE_IMAGE_B64, crop: 'wheat' }),
      });
      const verifyRes = await verifyRoutePost(verifyReq);
      const verifyText = await verifyRes.text();
      assert.equal(verifyText.includes(MOCK_GOOGLE_SECRET), false);
      assert.equal(verifyText.includes('Quota exhausted'), false);
    } finally {
      globalThis.fetch = origFetch;
      if (origKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origKey;
    }
  });

  await testCase('10. /api/weather and /api/tts hide upstream connection strings and credential details on failure', async () => {
    const origFetch = globalThis.fetch;
    const origAzure = process.env.AZURE_SPEECH_KEY;
    process.env.AZURE_SPEECH_KEY = 'az-secret-do-not-leak-987654';

    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED postgres://admin:dbsecret@internal-host:5432/prod');
    }) as typeof fetch;

    try {
      const weatherReq = new NextRequest('http://localhost/api/weather?lat=30.2&lon=71.5');
      const weatherRes = await weatherRouteGet(weatherReq);
      const weatherText = await weatherRes.text();
      assert.equal(weatherText.includes('ECONNREFUSED'), false);
      assert.equal(weatherText.includes('dbsecret'), false);
      assert.equal(weatherText.includes('postgres://'), false);

      const ttsReq = new NextRequest(
        'http://localhost/api/tts?text=Salam&lang=en&voice=en-US-JennyNeural'
      );
      const ttsRes = await ttsRouteGet(ttsReq);
      const ttsText = await ttsRes.text();
      assert.equal(ttsText.includes('az-secret-do-not-leak-987654'), false);
      assert.equal(ttsText.includes('dbsecret'), false);
      assert.equal(ttsText.includes('AZURE_SPEECH_KEY'), false);
    } finally {
      globalThis.fetch = origFetch;
      if (origAzure === undefined) delete process.env.AZURE_SPEECH_KEY;
      else process.env.AZURE_SPEECH_KEY = origAzure;
    }
  });

  await testCase('11. /api/admin/diagnostics enforces strict auth (401/403) and masks all credentials when unlocked', async () => {
    clearInternalDiagnosticsForTests();
    const origSecret = process.env.ADMIN_DIAGNOSTICS_SECRET;
    const origGemini = process.env.GEMINI_API_KEY;
    const origServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    process.env.ADMIN_DIAGNOSTICS_SECRET = 'SuperSecureAdminSecret123456!';
    process.env.GEMINI_API_KEY = MOCK_GOOGLE_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = MOCK_JWT_SECRET;

    recordDiagnosticEvent({
      service: 'vision',
      category: 'service_misconfigured',
      code: 'TEST_LEAK_GUARD',
      statusCode: 401,
      summary: `Upstream rejected key ${MOCK_GOOGLE_SECRET} and token ${MOCK_JWT_SECRET}`,
    });

    try {
      // Unauthenticated request -> 401
      const unauthReq = new NextRequest('http://localhost/api/admin/diagnostics');
      const unauthRes = await adminDiagnosticsGet(unauthReq);
      assert.equal(unauthRes.status, 401);
      const unauthBody = await unauthRes.text();
      assert.equal(unauthBody.includes('envConfiguration'), false);

      // Wrong secret -> 403
      const wrongReq = new NextRequest('http://localhost/api/admin/diagnostics', {
        headers: { 'x-admin-secret': 'wrong-secret-attempt' },
      });
      const wrongRes = await adminDiagnosticsGet(wrongReq);
      assert.equal(wrongRes.status, 403);
      const wrongBody = await wrongRes.text();
      assert.equal(wrongBody.includes('SuperSecureAdminSecret'), false);

      // Valid admin secret -> 200 with masked env & redacted logs
      const validReq = new NextRequest('http://localhost/api/admin/diagnostics', {
        headers: { 'x-admin-secret': 'SuperSecureAdminSecret123456!' },
      });
      const validRes = await adminDiagnosticsGet(validReq);
      assert.equal(validRes.status, 200);
      assert.ok((validRes.headers.get('cache-control') || '').includes('no-store'));

      const validText = await validRes.text();
      assert.equal(validText.includes(MOCK_GOOGLE_SECRET), false);
      assert.equal(validText.includes(MOCK_JWT_SECRET), false);
      assert.equal(validText.includes('SuperSecureAdminSecret'), false);

      const payload = JSON.parse(validText);
      assert.equal(payload.envConfiguration.visionAiKey.configured, true);
      assert.equal(payload.envConfiguration.visionAiKey.masked, '•••••••• (Configured server-side)');
      assert.equal(payload.envConfiguration.supabaseServiceRole.configured, true);
      assert.ok(payload.recentEvents.length === 1);
      assert.ok(payload.recentEvents[0].summary.includes('[REDACTED_CREDENTIAL]'));
      assert.ok(payload.recentEvents[0].summary.includes('[REDACTED_TOKEN]'));
    } finally {
      if (origSecret === undefined) delete process.env.ADMIN_DIAGNOSTICS_SECRET;
      else process.env.ADMIN_DIAGNOSTICS_SECRET = origSecret;
      if (origGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origGemini;
      if (origServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceRole;
    }
  });

  console.log(`\nSecurity Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Security test suite failed cleanly:', err);
  process.exit(1);
});
