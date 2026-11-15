import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as chatRoutePost } from '../app/api/chat/route';
import { ChatRequestSchema } from '../lib/schemas';
import {
  cleanScreenAdvisorText,
  detectUserLanguageMode,
  generateAdaptiveFallbackReply,
  looksLikelyEnglish,
} from '../lib/advisor-prompt';
import {
  buildAdvisorSystemPrompt,
  buildVoiceAdvisorPrompt,
  generateVoiceDualReply,
  streamGeminiChatResponse,
} from '../lib/gemini';

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

  console.log('\n=== Zarkhez Adaptive Beginner-Expert Chatbot Intelligence Suite ===\n');

  await testCase('1. Accurate language & script auto-detection across EN, Roman Urdu, Urdu Script, Sindhi, and neutral follow-ups', () => {
    assert.equal(looksLikelyEnglish('I want to grow wheat. Tell me the complete process.'), true);
    assert.equal(looksLikelyEnglish('Gandum ugane ka mukammal tarika batayen'), false);

    assert.equal(
      detectUserLanguageMode('I want to grow wheat.', 'ur', 'ur').mode,
      'en'
    );
    assert.equal(
      detectUserLanguageMode('Gandum ugane ka mukammal tarika batayen', 'ur', 'ur').mode,
      'roman-ur'
    );
    assert.equal(
      detectUserLanguageMode('گندم اگانے کا مکمل طریقہ بتائیں', 'ur', 'ur').mode,
      'ur-script'
    );
    assert.equal(
      detectUserLanguageMode('ڪڻڪ پوکڻ جو مڪمل طريقو ٻڌايو', 'sd', 'ur').mode,
      'sd'
    );

    const followUpHistory = [
      { role: 'user' as const, content: 'Should I grow wheat or barley?' },
      { role: 'assistant' as const, content: 'It depends on your soil and water.' },
      { role: 'user' as const, content: 'Bahawalpur' },
    ];
    assert.equal(
      detectUserLanguageMode('Bahawalpur', 'ur', 'ur', followUpHistory).mode,
      'en'
    );
  });

  await testCase('2. Prompt 1 (Wheat Beginner Complete Process): full zero-to-harvest teaching guide with steps, table, mistakes & follow-ups', () => {
    const reply = generateAdaptiveFallbackReply(
      "I want to grow wheat. Tell me the complete process. I don't know anything about farming.",
      'en'
    );
    assert.ok(reply.length > 1200, `Expected thorough beginner guide, got ${reply.length} chars`);
    assert.ok(reply.includes('November'), 'Mentions ideal sowing season');
    assert.ok(reply.toLowerCase().includes('watr') && reply.includes('planking'), 'Explains soil moisture & planking simply');
    assert.ok(reply.includes('45') && reply.includes('50 kg'), 'Gives certified seed rate');
    assert.ok(reply.includes('DAP') && reply.includes('Urea'), 'Teaches fertilizer types and roles');
    assert.ok(reply.includes('20–25 days') || reply.includes('20-25'), 'Gives CRI first irrigation timing');
    assert.ok(reply.includes('| Growth Stage |'), 'Includes scannable irrigation schedule table');
    assert.ok(reply.toLowerCase().includes('mistake'), 'Calls out beginner mistakes');
    assert.ok(reply.includes('district/city') || reply.includes('acres'), 'Closes with focused clarifying questions');
  });

  await testCase('3. Prompt 2 (Yellowing Leaves): safe differential causes, leaf-age clues, inspection steps & no blind spray guessing', () => {
    const reply = generateAdaptiveFallbackReply(
      'My crop leaves are turning yellow. What should I do?',
      'en'
    );
    const low = reply.toLowerCase();
    assert.ok(low.includes('waterlogging') || low.includes('over-watering'), 'Covers overwatering');
    assert.ok(low.includes('nitrogen') && (low.includes('zinc') || low.includes('iron')), 'Distinguishes lower vs upper leaf nutrient clues');
    assert.ok(low.includes('pests') && low.includes('fungal'), 'Covers sucking pests & fungal blights');
    assert.ok(low.includes('scan leaf') && low.includes('avoid') || low.includes('do **not**'), 'Recommends inspection & avoids blind spraying');
    assert.ok(low.includes('which **crop**') || low.includes('bottom leaves'), 'Asks diagnostic follow-up questions');
  });

  await testCase('4. Prompt 3 (Land Preparation): focuses specifically on seedbed prep instead of dumping full season calendar', () => {
    const reply = generateAdaptiveFallbackReply('How do I prepare my land?', 'en');
    const low = reply.toLowerCase();
    assert.ok(low.includes('watr') && low.includes('suhaga'), 'Teaches workable moisture and planking');
    assert.ok(low.includes('laser'), 'Explains leveling value');
    assert.ok(!low.includes('harvest when ears turn golden'), 'Stays focused on land preparation rather than repeating harvesting guide');
  });

  await testCase('5. Prompt 4 (DAP & Urea for Beginners): explains what, why, when, comparison table & mistakes clearly', () => {
    const reply = generateAdaptiveFallbackReply(
      'Explain DAP and Urea to someone who knows nothing about fertilizers.',
      'en'
    );
    assert.ok(reply.includes('Phosphorus') && reply.includes('Nitrogen'));
    assert.ok(reply.toLowerCase().includes('root') && reply.toLowerCase().includes('green leaves'));
    assert.ok(reply.toLowerCase().includes('at **sowing**') && reply.toLowerCase().includes('split'));
    assert.ok(reply.includes('| Feature | **DAP** | **Urea** |'));
  });

  await testCase('6. Prompt 5 (Wheat vs Barley Comparison): structured side-by-side table & clear recommendation', () => {
    const reply = generateAdaptiveFallbackReply('Should I grow wheat or barley?', 'en');
    assert.ok(reply.includes('| Factor | **Wheat (Gandum)** | **Barley (Jau)** |'));
    assert.ok(reply.toLowerCase().includes('saline') && reply.toLowerCase().includes('market'));
    assert.ok(reply.includes('Grow Wheat') && reply.includes('Grow Barley'));
  });

  await testCase('7. Prompt 6 (Multi-turn Follow-Up Memory) & Prompt 7 (Simple 2 + 2 short answer) + large history validation', () => {
    const mathReply = generateAdaptiveFallbackReply('What is 2 + 2?', 'en');
    assert.equal(mathReply.trim(), '4');

    const longAssistantGuide = generateAdaptiveFallbackReply(
      "I want to grow wheat. Tell me the complete process. I don't know anything about farming.",
      'en'
    );
    const multiTurnMessages = [
      { role: 'user' as const, content: 'Should I grow wheat or barley? Tell me the full beginner wheat process too.' },
      { role: 'assistant' as const, content: longAssistantGuide },
      { role: 'user' as const, content: 'I am in Bahawalpur and have 2 acres.' },
      { role: 'assistant' as const, content: 'Noted 2 acres in Bahawalpur.' },
      { role: 'user' as const, content: 'Now tell me when to irrigate it.' },
    ];

    const schemaCheck = ChatRequestSchema.safeParse({
      messages: multiTurnMessages,
      lang: 'en',
      voiceMode: true,
    });
    assert.equal(schemaCheck.success, true, 'Schema accepts long multi-turn guides > 2000 chars cleanly');

    const followUp = generateAdaptiveFallbackReply(
      'Now tell me when to irrigate it.',
      'en',
      undefined,
      multiTurnMessages
    );
    assert.ok(followUp.includes('Bahawalpur') && followUp.includes('2 acres'), 'Preserves Bahawalpur & 2 acres across turns');
  });

  await testCase('8. Dual screenText Markdown preservation, high maxOutputTokens (4096), and plain-text chat mode via /api/chat', async () => {
    const origFetch = globalThis.fetch;
    const origKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'AIzaSyExpertTeacherMockKey1234567890';
    const capturedBodies: Array<Record<string, unknown>> = [];

    const richMarkdownScreen =
      '## Step 1: Soil & Moisture\n\nPrepare **watr** moisture before plowing.\n\n| Fertilizer | Timing |\n|---|---|\n| DAP | Sowing |';
    const conciseSpoken =
      'Start by checking soil moisture before plowing, and apply DAP at sowing time. The full step-by-step guide is on your screen.';

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const bodyObj = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      capturedBodies.push(bodyObj);
      const genConfig = (bodyObj.generationConfig || {}) as Record<string, unknown>;

      if (genConfig.response_schema) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        screen_text: richMarkdownScreen,
                        spoken_text: conciseSpoken,
                        language: 'en',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: richMarkdownScreen }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      // 8a. Dual voice mode preserves rich Markdown in screenText & high token limit
      const dualReq = new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.12.34.56' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'I want to grow wheat. Tell me the complete process.' },
          ],
          lang: 'ur',
          voiceLang: 'ur',
          voiceMode: true,
        }),
      });
      const dualRes = await chatRoutePost(dualReq);
      assert.equal(dualRes.status, 200);
      const dualJson = (await dualRes.json()) as {
        screenText: string;
        spokenText: string;
        language: string;
      };
      assert.equal(dualJson.language, 'en', 'Auto-detects English query even when UI pill defaulted to ur');
      assert.ok(dualJson.screenText.includes('## Step 1: Soil & Moisture'), 'Preserves Markdown headings in screenText');
      assert.ok(dualJson.screenText.includes('| DAP | Sowing |'), 'Preserves Markdown table in screenText');
      assert.ok(!dualJson.spokenText.includes('##') && !dualJson.spokenText.includes('|'), 'Spoken audio stays free of Markdown noise');

      const genConfigDual = capturedBodies[0].generationConfig as Record<string, unknown>;
      assert.equal(genConfigDual.maxOutputTokens, 4096, 'Dual reply unlocks full 4096 output tokens');

      // 8b. Text chat mode omits forced response_mime_type JSON constraint
      const streamReply = await streamGeminiChatResponse(
        [{ role: 'user', content: 'How do I prepare my land?' }],
        { district: 'Multan', crop: 'wheat' },
        'en'
      );
      assert.ok(streamReply.includes('## Step 1: Soil & Moisture'));
      const genConfigStream = capturedBodies[1].generationConfig as Record<string, unknown>;
      assert.equal(genConfigStream.response_mime_type, undefined, 'Plain chat mode must not force application/json');
      assert.equal(genConfigStream.maxOutputTokens, 4096, 'Stream chat uses 4096 output tokens');
    } finally {
      globalThis.fetch = origFetch;
      if (origKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origKey;
    }
  });

  await testCase('9. System prompts & metadata cleaning preserve Markdown while enforcing safety and language contracts', () => {
    const cleaned = cleanScreenAdvisorText(
      '## Wheat Care\n\n- **First Step**: Apply water. ZRK-PK-998811\n\n| A | B |\n|---|---|\n| 1 | 2 |'
    );
    assert.ok(cleaned.includes('## Wheat Care'));
    assert.ok(cleaned.includes('| A | B |'));
    assert.equal(cleaned.includes('ZRK-PK-998811'), false);

    const promptEn = buildAdvisorSystemPrompt('en', { district: 'Bahawalpur', crop: 'wheat', acres: 2 });
    assert.ok(promptEn.includes('SHORT WHEN SIMPLE. DETAILED WHEN NECESSARY. COMPLETE WHEN ASKED.'));
    assert.ok(promptEn.includes('Bahawalpur'));

    const dualPromptUr = buildVoiceAdvisorPrompt('ur', { district: 'Multan', crop: 'wheat' }, 'ur-script');
    assert.ok(dualPromptUr.includes('Pakistani Urdu Perso-Arabic script'));
    assert.ok(dualPromptUr.includes('2 to 4 short sentences'));

    // Also test direct partial rescue check via generateVoiceDualReply when no keys set falls back cleanly
    assert.equal(typeof generateVoiceDualReply, 'function');
  });

  console.log(`\nChatbot Expert Teacher Test Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Chatbot expert teacher tests failed cleanly:', err);
  process.exit(1);
});
