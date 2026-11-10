import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  integerToWords,
  timeToSpokenWords,
  SINDHI_NUMBER_AND_UNIT_RULES,
} from '../lib/voice/number-words';
import {
  SINDHI_SPECIFIC_CHARS,
  assertSindhiLettersPreserved,
  isProviderAllowedForLanguage,
} from '../lib/voice/script-guard';
import { toSpokenText } from '../lib/voice/spoken-normalizer';
import { buildVoiceSsml, buildPlsDocument } from '../lib/voice/ssml-builder';
import { getProviderPriorityChain, VOICE_PROFILES } from '../lib/voice/service';
import {
  clearLexiconHotCacheForTests,
  loadHotPronunciationLexicon,
} from '../lib/voice/server-lexicon';
import { buildVoiceAdvisorPrompt, generateSpokenFallbackChatReply } from '../lib/gemini';
import { GET as ttsRouteGet, POST as ttsRoutePost } from '../app/api/tts/route';
import { POST as sttRoutePost } from '../app/api/stt/route';
import { POST as voiceFeedbackPost } from '../app/api/voice/feedback/route';

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

  console.log('\n=== Zarkhez Pakistani Urdu & Sindhi Voice Pipeline Test Suite ===\n');

  await testCase('1. Urdu exact number-to-words & time conversion matches Pakistani standards', () => {
    assert.equal(integerToWords(27, 'ur'), 'ستائیس');
    assert.equal(integerToWords(41, 'ur'), 'اکتالیس');
    assert.equal(integerToWords(79, 'ur'), 'اناسی');
    assert.equal(integerToWords(85000, 'ur'), 'پچاسی ہزار');
    assert.equal(timeToSpokenWords(6, 39, 'ur'), 'صبح چھ بج کر انتالیس منٹ');
    assert.equal(timeToSpokenWords(17, 41, 'ur'), 'شام پانچ بج کر اکتالیس منٹ');
  });

  await testCase('2. toSpokenText expands all digits, units, symbols, markdown, and loanwords cleanly for Urdu', () => {
    const sample =
      'آج **حیدرآباد** میں درجہ حرارت 27°C، نمی 41%، ہوا 3.1 m/s ہے۔ ☀️ طلوع 06:39 اور غروب 17:41۔ یوریا 50 kg/acre اور Ridomil Gold کا spray کریں۔';
    const res = toSpokenText(sample, 'ur');

    assert.ok(res.spokenText.includes('ستائیس ڈگری سینٹی گریڈ'), '27°C expanded');
    assert.ok(res.spokenText.includes('اکتالیس فیصد'), '41% expanded');
    assert.ok(res.spokenText.includes('تین اعشاریہ ایک میٹر فی سیکنڈ'), '3.1 m/s expanded');
    assert.ok(res.spokenText.includes('صبح چھ بج کر انتالیس منٹ'), '06:39 expanded');
    assert.ok(res.spokenText.includes('شام پانچ بج کر اکتالیس منٹ'), '17:41 expanded');
    assert.ok(res.spokenText.includes('پچاس کلو فی ایکڑ'), '50 kg/acre expanded');
    assert.ok(res.spokenText.includes('ریڈومل'), 'Brand loanword mapped via lexicon');
    assert.ok(res.spokenText.includes('سپرے'), 'spray loanword mapped');
    assert.equal(/\d/.test(res.spokenText), false, 'Zero raw ASCII digits remain in spokenText');
    assert.equal(/[*#`%°☀️]/.test(res.spokenText), false, 'Zero symbols or emojis remain in spokenText');
  });

  await testCase('3. Sindhi script preservation keeps ALL Sindhi characters intact and flags native review', () => {
    const sindhiSample =
      'ڀاءُ ٻنيءَ ۾ ڄار ڃاڻ ڇاڻ ڏي ڊاڪٽر ڌيان ڍور ڙڦ ڪڻڪ ڳوٺ ڱڻڻ ٿر ٺٽو ٽماٽر يوريا هاري 27°C 06:39 kg/acre';
    const res = toSpokenText(sindhiSample, 'sd');

    assert.equal(res.localeCode, 'sd-PK');
    assert.equal(res.preservesSindhiLetters, true);
    assert.equal(res.needsNativeReview, true);

    const check = assertSindhiLettersPreserved(sindhiSample, res.spokenText);
    assert.equal(check.valid, true, `Missing Sindhi chars: ${check.missingChars.join(',')}`);
    for (const ch of SINDHI_SPECIFIC_CHARS) {
      assert.ok(res.spokenText.includes(ch), `Sindhi char ${ch} must be preserved verbatim`);
    }
    assert.equal(/\d/.test(res.spokenText), false, 'Zero digits remain in Sindhi spoken text');
    assert.ok(SINDHI_NUMBER_AND_UNIT_RULES.every((r) => r.needs_native_review));
  });

  await testCase('4. Sindhi is NEVER routed to Azure Neural (non-Sindhi engine); Urdu & Sindhi have separate Male/Female voices', () => {
    assert.equal(isProviderAllowedForLanguage('azure-neural', 'sd'), false);
    assert.equal(isProviderAllowedForLanguage('azure-neural', 'ur'), true);

    const sdChain = getProviderPriorityChain('sd', 'azure-neural');
    assert.equal(sdChain.includes('azure-neural'), false, 'Even forced preferProvider cannot route Sindhi to Azure');

    assert.ok(VOICE_PROFILES.ur.female && VOICE_PROFILES.ur.male);
    assert.ok(VOICE_PROFILES.sd.female && VOICE_PROFILES.sd.male);
    assert.equal('azureVoice' in VOICE_PROFILES.sd.female, false);
  });

  await testCase('5. SSML builder sets explicit language tag, calm 0.9x & 0.75x rates, pauses, and generates PLS XML', () => {
    const lexicon = loadHotPronunciationLexicon();
    const ssmlNormal = buildVoiceSsml({
      text: 'آج حیدرآباد میں درجہ حرارت 27°C ہے۔',
      lang: 'ur',
      voiceName: 'ur-PK-UzmaNeural',
      speedMode: 'normal',
      lexiconEntries: lexicon,
    });
    assert.ok(ssmlNormal.includes('xml:lang="ur-PK"'));
    assert.ok(ssmlNormal.includes('rate="-10%"'));
    assert.ok(ssmlNormal.includes('<break time="220ms"/>'));
    assert.ok(ssmlNormal.includes('<phoneme'));

    const ssmlSlow = buildVoiceSsml({
      text: 'اڄ حيدرآباد ۾ گرمي پد 27°C آهي.',
      lang: 'sd',
      voiceName: 'Charon',
      speedMode: 'slow',
      lexiconEntries: lexicon,
    });
    assert.ok(ssmlSlow.includes('xml:lang="sd-PK"'));
    assert.ok(ssmlSlow.includes('rate="-25%"'));

    const pls = buildPlsDocument('sd', lexicon.slice(0, 4));
    assert.ok(pls.includes('<lexicon version="1.0"'));
    assert.ok(pls.includes('xml:lang="sd-PK"'));
    assert.ok(pls.includes('<phoneme>'));
  });

  await testCase('6. Pronunciation lexicon hot-reloads file changes without code modification', () => {
    const lexPath = path.resolve('data/voice/pronunciation-lexicon.json');
    const orig = fs.readFileSync(lexPath, 'utf8');
    const parsed = JSON.parse(orig) as { version: string; updatedAt: string; notes: string; entries: Array<Record<string, unknown>> };

    try {
      clearLexiconHotCacheForTests();
      const customEntry = {
        id: 'test_hot_word',
        term: 'HydroponicTest',
        aliases: ['HydroponicTest'],
        category: 'farming',
        spokenUr: 'ہائیڈرو پونک ٹیسٹ',
        spokenSd: 'هائيڊرو پونڪ ٽيسٽ',
        spokenEn: 'Hydroponic Test',
        needs_native_review: true,
      };
      const mutated = { ...parsed, entries: [...parsed.entries, customEntry] };
      fs.writeFileSync(lexPath, JSON.stringify(mutated, null, 2), 'utf8');

      const reloaded = loadHotPronunciationLexicon();
      const found = reloaded.find((e) => e.id === 'test_hot_word');
      assert.ok(found, 'Hot-reloaded lexicon must read new entry from disk immediately');

      const out = toSpokenText('Try HydroponicTest today', 'ur', { lexiconEntries: reloaded });
      assert.ok(out.spokenText.includes('ہائیڈرو پونک ٹیسٹ'));
    } finally {
      fs.writeFileSync(lexPath, orig, 'utf8');
      clearLexiconHotCacheForTests();
    }
  });

  await testCase('7. String tables, glossary, Sindhi review CSV, and 60+60 voice test set meet structure rules', () => {
    const urStrings = JSON.parse(fs.readFileSync(path.resolve('data/voice/spoken-strings-ur.json'), 'utf8'));
    const sdStrings = JSON.parse(fs.readFileSync(path.resolve('data/voice/spoken-strings-sd.json'), 'utf8'));
    const glossary = JSON.parse(fs.readFileSync(path.resolve('data/voice/glossary.json'), 'utf8'));
    const testSet = JSON.parse(fs.readFileSync(path.resolve('data/voice/voice-test-set.json'), 'utf8'));
    const csvLines = fs.readFileSync(path.resolve('data/voice/sindhi-review.csv'), 'utf8').trim().split(/\r?\n/);

    assert.equal(sdStrings.needs_native_review, true);
    for (const key of Object.keys(urStrings.strings)) {
      assert.ok(sdStrings.strings[key], `Missing Sindhi string for key: ${key}`);
      assert.equal(sdStrings.strings[key].needs_native_review, true);
      assert.equal(sdStrings.strings[key].approved, false);
    }

    assert.ok(glossary.terms.length >= 25);
    assert.ok(glossary.terms.every((t: { needs_native_review: boolean }) => t.needs_native_review === true));

    assert.equal(csvLines[0], 'key,English,Urdu,Sindhi,notes,approved');
    assert.ok(csvLines.length >= 20);
    assert.ok(csvLines.slice(1).every((line) => line.endsWith(',false')));

    assert.equal(testSet.urdu.length, 60, 'voice-test-set.json must contain 60 Urdu phrases');
    assert.equal(testSet.sindhi.length, 60, 'voice-test-set.json must contain 60 Sindhi phrases');
  });

  await testCase('8. Voice-mode assistant prompt & fallback produce 2-4 clean Urdu/Sindhi sentences (dual screen vs spoken)', () => {
    const promptSd = buildVoiceAdvisorPrompt('sd', { crop: 'rice', district: 'Badin' });
    assert.ok(promptSd.includes('Answer ONLY'));
    assert.ok(promptSd.includes('2 to 4 short sentences'));

    const fallbackSd = generateSpokenFallbackChatReply('گندم کو پہلا پانی کب دیں؟', 'sd');
    assert.equal(fallbackSd.language, 'sd');
    assert.equal(/[*#•\d]/.test(fallbackSd.spokenText), false, 'Voice reply must contain no digits or markdown symbols');

    const fallbackUr = generateSpokenFallbackChatReply('Gandum ko pani kab lagayein?', 'ur');
    assert.equal(fallbackUr.language, 'ur');
    assert.ok(/[\u0600-\u06FF]/.test(fallbackUr.spokenText), 'Spoken output responds in proper Urdu script even when input is Roman Urdu');
  });

  await testCase('9. /api/tts sends strictly spoken text (zero prompt rules read aloud), locks female voice, and avoids Google Translate', async () => {
    const origFetch = globalThis.fetch;
    const origGeminiKey = process.env.GEMINI_API_KEY;
    const sentPayloads: string[] = [];

    process.env.GEMINI_API_KEY = 'AIzaSyVoicePipelineMockTestKey123456';
    const fakeWav = Buffer.alloc(256);
    fakeWav.write('RIFF', 0);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      assert.equal(url.includes('translate.google.com/translate_tts'), false, 'Forbidden Google Translate TTS called');
      if (init?.body && typeof init.body === 'string') {
        sentPayloads.push(init.body);
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'audio/wav', data: fakeWav.toString('base64') } }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const reqSd = new NextRequest('http://localhost/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'اڄ حيدرآباد ۾ گرمي پد 27°C آهي.',
          lang: 'sd',
          gender: 'male',
          speedMode: 'slow',
          skipCache: true,
        }),
      });
      const res = await ttsRoutePost(reqSd);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('X-Voice-Locale'), 'sd-PK');
      assert.equal(res.headers.get('X-Voice-Provider'), 'gemini-tts');
      assert.ok(decodeURIComponent(res.headers.get('X-Spoken-Text') || '').includes('ستاويهه'));

      assert.ok(sentPayloads.length === 1);
      const sentJson = JSON.parse(sentPayloads[0]) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } };
      };
      const ttsText = sentJson.contents[0].parts[0].text;
      assert.equal(/Speak strictly|Read strictly|tone|rules/i.test(ttsText), false, 'TTS payload must NEVER include English prompt instructions');
      assert.equal(
        sentJson.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
        'Aoede',
        'Voice must remain locked to single best female voice'
      );

      const reqEmpty = new NextRequest('http://localhost/api/tts?lang=ur&text=');
      const resEmpty = await ttsRouteGet(reqEmpty);
      assert.equal(resEmpty.status, 400);
    } finally {
      globalThis.fetch = origFetch;
      if (origGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origGeminiKey;
    }
  });

  await testCase('10. /api/stt transcribes explicitly for ur-PK / sd-PK and /api/voice/feedback accepts reports safely', async () => {
    const origFetch = globalThis.fetch;
    const origGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'AIzaSyVoicePipelineMockTestKey123456';

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'اڄ ميرپور خاص ۾ موسم صاف آهي' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as typeof fetch;

    try {
      const sttReq = new NextRequest('http://localhost/api/stt', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.88.1.1' },
        body: JSON.stringify({
          audioBase64: Buffer.from('mock-audio-data-over-32-bytes-long-padding').toString('base64'),
          mimeType: 'audio/webm',
          lang: 'sd',
        }),
      });
      const sttRes = await sttRoutePost(sttReq);
      assert.equal(sttRes.status, 200);
      const sttJson = (await sttRes.json()) as { transcript: string; localeCode: string };
      assert.equal(sttJson.localeCode, 'sd-PK');
      assert.ok(sttJson.transcript.includes('ميرپور خاص'));

      const fbReq = new NextRequest('http://localhost/api/voice/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          word: 'Mirpurkhas',
          lang: 'sd',
          audioId: 'gem-test123',
        }),
      });
      const fbRes = await voiceFeedbackPost(fbReq);
      assert.equal(fbRes.status, 200);
      const fbJson = (await fbRes.json()) as { saved: boolean };
      assert.equal(fbJson.saved, true);
    } finally {
      globalThis.fetch = origFetch;
      if (origGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = origGeminiKey;
      // Clean up test jsonl append if written
      const fbPath = path.resolve('data/voice/pronunciation-feedback.jsonl');
      if (fs.existsSync(fbPath)) {
        const lines = fs
          .readFileSync(fbPath, 'utf8')
          .split(/\r?\n/)
          .filter((l) => l && !l.includes('gem-test123'));
        if (lines.length === 0) fs.unlinkSync(fbPath);
        else fs.writeFileSync(fbPath, `${lines.join('\n')}\n`, 'utf8');
      }
    }
  });

  console.log(`\nVoice Pipeline Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Voice pipeline tests failed cleanly:', err);
  process.exit(1);
});
