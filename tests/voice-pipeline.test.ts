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
import {
  buildScanVoiceNarration,
  cleanTechnicalMetadataForSpeech,
  looksLikeRomanUrdu,
  prepareSpeechText,
  splitSpeechIntoChunks,
  transliterateCommonRomanUrduToUrdu,
} from '../lib/voice/speech-prep';
import { buildVoiceSsml, buildPlsDocument } from '../lib/voice/ssml-builder';
import { CropDiagnosisSchema } from '../lib/schemas';
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

  await testCase('5. SSML builder sets explicit language tag, natural 1.0x / 0.82x rates, pitch 0%, clean paragraphs, and selective foreign phonemes', () => {
    const lexicon = loadHotPronunciationLexicon();
    const ssmlNormal = buildVoiceSsml({
      text: 'آج حیدرآباد میں Ridomil کا درجہ حرارت 27°C ہے۔ اگلی سطر سنیں۔',
      lang: 'ur',
      voiceName: 'ur-PK-UzmaNeural',
      speedMode: 'normal',
      lexiconEntries: lexicon,
    });
    assert.ok(ssmlNormal.includes('xml:lang="ur-PK"'));
    assert.ok(ssmlNormal.includes('rate="0%"'));
    assert.ok(ssmlNormal.includes('pitch="0%"'));
    assert.ok(ssmlNormal.includes('<p><s>'));
    assert.ok(ssmlNormal.includes('<break time="120ms"/>'));
    assert.ok(ssmlNormal.includes('<phoneme'));
    assert.equal(ssmlNormal.includes('<break time="75ms"/>'), false, 'Must not inject choppy breaks mid-phrase before units');

    const ssmlSlow = buildVoiceSsml({
      text: 'اڄ حيدرآباد ۾ گرمي پد 27°C آهي.',
      lang: 'sd',
      voiceName: 'Charon',
      speedMode: 'slow',
      lexiconEntries: lexicon,
    });
    assert.ok(ssmlSlow.includes('xml:lang="sd-PK"'));
    assert.ok(ssmlSlow.includes('rate="-18%"'));

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

  await testCase('11. Azure Speech is primary TTS engine for English (Ava/Andrew) & Urdu (Uzma/Asad) with resource verification & Roman Urdu rescue', async () => {
    assert.equal(getProviderPriorityChain('ur')[0], 'azure-neural');
    assert.equal(getProviderPriorityChain('en')[0], 'azure-neural');
    assert.equal(VOICE_PROFILES.ur.female.azureVoice, 'ur-PK-UzmaNeural');
    assert.equal(VOICE_PROFILES.ur.male.azureVoice, 'ur-PK-AsadNeural');
    assert.equal(VOICE_PROFILES.en.female.azureVoice, 'en-US-AvaMultilingualNeural');
    assert.equal(VOICE_PROFILES.en.male.azureVoice, 'en-US-AndrewMultilingualNeural');

    const origFetch = globalThis.fetch;
    const origAzureKey = process.env.AZURE_SPEECH_KEY;
    const origAzureRegion = process.env.AZURE_SPEECH_REGION;
    process.env.AZURE_SPEECH_KEY = 'azure-mock-test-key-123456';
    process.env.AZURE_SPEECH_REGION = 'eastus';

    const capturedSsml: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/cognitiveservices/voices/list')) {
        return new Response(
          JSON.stringify([
            { ShortName: 'ur-PK-UzmaNeural' },
            { ShortName: 'ur-PK-AsadNeural' },
            { ShortName: 'en-US-AvaMultilingualNeural' },
            { ShortName: 'en-US-AndrewMultilingualNeural' },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/cognitiveservices/v1')) {
        capturedSsml.push(String(init?.body || ''));
        return new Response(new Uint8Array(256).fill(1), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      }
      throw new Error(`Unexpected URL in Azure mock test: ${url}`);
    }) as typeof fetch;

    try {
      const reqUr = new NextRequest('http://localhost/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'آپ کے چاول کے پودے میں بلاسٹ بیماری کی علامات نظر آ رہی ہیں۔ پتوں پر لمبے اور نوکیلے دھبے موجود ہیں۔ متاثرہ پودوں کی نگرانی کریں اور مناسب حفاظتی اقدامات اختیار کریں۔',
          lang: 'ur',
          skipCache: true,
        }),
      });
      const resUr = await ttsRoutePost(reqUr);
      assert.equal(resUr.status, 200);
      assert.equal(resUr.headers.get('X-Voice-Provider'), 'azure-neural');
      assert.equal(resUr.headers.get('X-Voice-Locale'), 'ur-PK');
      assert.ok(capturedSsml[0].includes('ur-PK-UzmaNeural'));

      const reqEn = new NextRequest('http://localhost/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Your rice plant is showing symptoms of rice blast disease. The affected leaves have spindle-shaped lesions. Monitor the crop and follow appropriate management practices.',
          lang: 'en',
          skipCache: true,
        }),
      });
      const resEn = await ttsRoutePost(reqEn);
      assert.equal(resEn.status, 200);
      assert.equal(resEn.headers.get('X-Voice-Provider'), 'azure-neural');
      assert.equal(resEn.headers.get('X-Voice-Locale'), 'en-PK');
      assert.ok(capturedSsml[1].includes('en-US-AvaMultilingualNeural'));
      assert.ok(capturedSsml[1].includes('xml:lang="en-US"'));
    } finally {
      globalThis.fetch = origFetch;
      if (origAzureKey === undefined) delete process.env.AZURE_SPEECH_KEY;
      else process.env.AZURE_SPEECH_KEY = origAzureKey;
      if (origAzureRegion === undefined) delete process.env.AZURE_SPEECH_REGION;
      else process.env.AZURE_SPEECH_REGION = origAzureRegion;
    }
  });

  await testCase('12. Speech preparation cleans metadata, converts Roman Urdu cleanly, and splits long replies at sentence boundaries', () => {
    const rawDirty = '**Rice Blast** {"diagnosis_status": "possible_disease"} ID ZRK-PK-123456: Inspect leaves at **85%** severity.';
    const cleaned = cleanTechnicalMetadataForSpeech(rawDirty);
    assert.equal(cleaned.includes('ZRK-PK-123456'), false);
    assert.equal(cleaned.includes('diagnosis_status'), false);
    assert.equal(cleaned.includes('**'), false);

    const mixedHindiLeak = cleanTechnicalMetadataForSpeech('چاول کے پتوں پر دھब्बों کے لیے اسپرے کریں۔');
    assert.equal(/[\u0900-\u097F]/.test(mixedHindiLeak), false, 'Must repair stray Devanagari characters inside Urdu');
    assert.ok(mixedHindiLeak.includes('دھبوں'));

    const romanUr = 'Gandum ko pehla pani 20 din baad lagayein aur yurea khad dein.';
    assert.equal(looksLikeRomanUrdu(romanUr), true);
    const converted = transliterateCommonRomanUrduToUrdu(romanUr);
    assert.ok(converted.includes('گندم') && converted.includes('پانی') && converted.includes('یوریا'));
    assert.equal(looksLikeRomanUrdu('Your rice plant is showing signs of disease.'), false);

    const enPhrase = 'Your rice plant is showing symptoms of rice blast disease. The affected leaves have spindle-shaped lesions. Monitor the crop and follow appropriate management practices.';
    const urPhrase = 'آپ کے چاول کے پودے میں بلاسٹ بیماری کی علامات نظر آ رہی ہیں۔ پتوں پر لمبے اور نوکیلے دھبے موجود ہیں۔ متاثرہ پودوں کی نگرانی کریں اور مناسب حفاظتی اقدامات اختیار کریں۔';
    assert.ok(prepareSpeechText(enPhrase, 'en').includes('spindle-shaped lesions'));
    assert.ok(prepareSpeechText(urPhrase, 'ur').includes('بلاسٹ بیماری'));

    const longText = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} gives practical guidance for crop care.`).join(' ');
    const chunks = splitSpeechIntoChunks(longText, 'en', 220);
    assert.ok(chunks.length >= 2);
    assert.ok(chunks.every((c) => c.endsWith('.') && c.length <= 220));
  });

  await testCase('13. buildScanVoiceNarration builds accurate conversational advisor summaries for both diseased and healthy scans', () => {
    const diseased = CropDiagnosisSchema.parse({
      image_valid: true,
      detected_crop: 'Rice',
      detected_crop_ur: 'دھان',
      selected_crop: 'rice',
      crop_match: true,
      detected_plant_part: 'Leaf',
      detected_plant_part_ur: 'پتا',
      growth_stage: 'Tillering',
      growth_stage_ur: 'شگوفے',
      identification_confidence: 0.88,
      diagnosis_status: 'possible_disease',
      plant_condition: 'Infected',
      plant_condition_ur: 'متاثرہ',
      problem_name: { en: 'Rice Blast', ur: 'دھان کا بلاسٹ' },
      observed_symptoms: [{ en: 'spindle-shaped grey lesions on leaf', ur: 'پتے پر تکلا نما سرمئی دھبے' }],
      why_suspected: { en: 'Characteristic diamond spots with brown borders are visible', ur: 'بھورے کناروں والے تکلا نما دھبے نمایاں ہیں' },
      severity: 'medium',
      treatment_pillars: {
        immediate_actions: [{ en: 'scout neighboring tillers and pause extra urea', ur: 'ساتھ والے پودے چیک کریں اور اضافی یوریا روکیں' }],
      },
      requires_retake: false,
      requires_expert_review: true,
      message: { en: 'Rice blast detected', ur: 'بلاسٹ کی تصدیق ہوئی' },
    });

    const enNarration = buildScanVoiceNarration(diseased, 'en');
    assert.ok(enNarration.includes('Rice') && enNarration.includes('Rice Blast') && enNarration.includes('medium severity') && enNarration.includes('88%'));
    assert.ok(enNarration.includes('spindle-shaped grey lesions'));

    const urNarration = buildScanVoiceNarration(diseased, 'ur');
    assert.ok(urNarration.includes('دھان') && urNarration.includes('دھان کا بلاسٹ') && urNarration.includes('88%'));
    assert.ok(!urNarration.includes('نوعیت درمیانی نوعیت'), 'Must never duplicate severity wording in Urdu');

    const healthy = CropDiagnosisSchema.parse({
      ...diseased,
      diagnosis_status: 'healthy_no_symptoms',
      severity: 'low',
      problem_name: { en: 'Healthy Rice Leaf', ur: 'تندرست دھان کا پتا' },
      observed_symptoms: [],
      why_suspected: { en: 'Leaf blades look uniformly green without lesions', ur: 'پتا یکساں سرسبز اور صاف ہے' },
      treatment_pillars: { immediate_actions: [] },
      recommendations: [{ en: 'Continue regular morning field scouting', ur: 'صبح کے وقت باقاعدہ معائنہ جاری رکھیں' }],
      requires_expert_review: false,
    });
    const healthyEn = buildScanVoiceNarration(healthy, 'en');
    assert.ok(healthyEn.includes('appears healthy') && healthyEn.includes('no signs of infection'));
  });

  await testCase('14. Conversational EN+UR fluency, natural transitions, comma rhythm, and warm voice selection', () => {
    const enSteps = toSpokenText('1. Check leaves in daylight. 2. Apply urea later.', 'en');
    assert.ok(enSteps.spokenText.includes('First,') && enSteps.spokenText.includes('Second,'));
    assert.ok(!enSteps.spokenText.includes('Step first:'));

    const urSteps = toSpokenText('1. صبح کے وقت کھیت دیکھیں۔ 2. شام کو پانی دیں۔', 'ur');
    assert.ok(urSteps.spokenText.includes('پہلے،') && urSteps.spokenText.includes('دوسرے،'));

    const longUr = toSpokenText(
      'آپ کی گندم کی فصل میں پانی کی ہلکی کمی نظر آ رہی ہے، اس لیے آج شام زمین کا جائزہ لیں اور کل صبح ہلکی آبپاشی کر دیں تاکہ جڑوں کو وقت پر نمی مل سکے اور پتے مرجھائیں نہیں۔',
      'ur'
    );
    assert.ok(longUr.spokenText.includes('،'), 'Must preserve natural Urdu comma pauses inside connected clauses');

    assert.equal(VOICE_PROFILES.ur.female.geminiVoice, 'Sulafat');
    assert.equal(VOICE_PROFILES.en.female.geminiVoice, 'Aoede');

    const friendlySsml = buildVoiceSsml({
      text: "Check your leaves carefully today, and let's keep the crop healthy.",
      lang: 'en',
      voiceName: 'en-US-AvaMultilingualNeural',
      style: 'friendly',
    });
    assert.ok(friendlySsml.includes('xmlns:mstts="https://www.w3.org/2001/mstts"'));
    assert.ok(friendlySsml.includes('<mstts:express-as style="friendly"'));
  });

  console.log(`\nVoice Pipeline Summary: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Voice pipeline tests failed cleanly:', err);
  process.exit(1);
});
