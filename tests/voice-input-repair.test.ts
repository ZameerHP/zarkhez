/**
 * Comprehensive 18-Scenario End-to-End Voice Input & STT Pipeline Verification Suite
 * Exercises real Zarkhez modules:
 * - lib/voice/transcript-merger.ts (overlap deduplication, out-of-order sequencing, PCM16->WAV, input sync)
 * - lib/voice/speech-capture.ts (dual-track PCM WAV + Web Speech preview, MIME detection, fallbacks, Android conflict recovery)
 * - lib/voice/stt.ts & app/api/stt/route.ts (Gemini prompt/context/boostTerms, HTTP 404 model cascade, 5-account failover, timeout vs offline vs unavailable)
 * - lib/server/gemini-pool.ts & lib/ratelimit.ts (404 fix & dedicated 'stt' 80/10m namespace)
 */
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  clearGeminiPoolStateForTests,
  setIgnoreEnvFileForTests,
  setPoolNowProviderForTests,
  getGeminiPoolHealthSnapshot,
} from '../lib/server/gemini-pool';
import {
  OrderedChunkTranscriptBuffer,
  computeIncrementalInputValue,
  computePcm16RmsAndPeak,
  downsampleFloat32ToInt16,
  encodeMonoPcm16ToWavBytes,
  mergeTranscriptWithOverlap,
  normalizeSttSegment,
} from '../lib/voice/transcript-merger';
import {
  classifyMicrophoneError,
  composeDisplayTranscript,
  createFieldSpeechCapture,
  pickSupportedAudioMimeType,
  startFixedBrowserSpeechRecognition,
  type SpeechRecognitionLike,
} from '../lib/voice/speech-capture';
import { POST as sttRoutePost } from '../app/api/stt/route';
import { checkRateLimit } from '../lib/ratelimit';
import { redactSecrets } from '../lib/error-sanitizer';

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_PROJECT_ID',
  'GEMINI_MODEL_FAST',
  'OPENAI_API_KEY',
  'ASSEMBLYAI_API_KEY',
  'GEMINI_API_KEY_1',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_PROJECT_ID_1',
  'GEMINI_PROJECT_ID_2',
  'GEMINI_PROJECT_ID_3',
  'GEMINI_PROJECT_ID_4',
  'GEMINI_PROJECT_ID_5',
  'GEMINI_ENABLED_1',
  'GEMINI_ENABLED_2',
  'GEMINI_ENABLED_3',
  'GEMINI_ENABLED_4',
  'GEMINI_ENABLED_5',
] as const;

const TEST_KEYS = [
  'AIzaSyVoiceTest1_0000000000000001',
  'AIzaSyVoiceTest2_0000000000000002',
  'AIzaSyVoiceTest3_0000000000000003',
  'AIzaSyVoiceTest4_0000000000000004',
  'AIzaSyVoiceTest5_0000000000000005',
];

function resetGeminiEnv(): void {
  clearGeminiPoolStateForTests();
  setIgnoreEnvFileForTests(true);
  setPoolNowProviderForTests(null);
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
  for (let i = 1; i <= 5; i++) {
    process.env[`GEMINI_API_KEY_${i}`] = TEST_KEYS[i - 1];
    process.env[`GEMINI_PROJECT_ID_${i}`] = `voice-proj-${i}`;
    process.env[`GEMINI_ENABLED_${i}`] = 'true';
  }
}

function getSlotFromUrl(url: string): number {
  const m = /[?&]key=([^&]+)/.exec(url);
  if (!m) return -1;
  return TEST_KEYS.indexOf(decodeURIComponent(m[1])) + 1;
}

function getModelFromUrl(url: string): string {
  const m = /\/models\/([^:]+):generateContent/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}

function makeGeminiOk(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/** Creates synthetic spoken audio Float32 waveform (440Hz + harmonics) or silence. */
function makePcmBuffer(durationSec: number, sampleRate: number, amplitude = 0.25): Float32Array {
  const len = Math.round(durationSec * sampleRate);
  const out = new Float32Array(len);
  if (amplitude <= 0) return out;
  for (let i = 0; i < len; i++) {
    out[i] =
      amplitude * 0.7 * Math.sin((2 * Math.PI * 220 * i) / sampleRate) +
      amplitude * 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return out;
}

/**
 * Harness simulating real browser AudioContext + ScriptProcessorNode + SpeechRecognition
 * connected directly into createFieldSpeechCapture and optionally routing /api/stt straight
 * to our real Next.js App Router POST handler!
 */
function createMockAudioEnv(opts: {
  sampleRate?: number;
  withAudioContext?: boolean;
  withMediaRecorder?: boolean;
  mimeSupported?: (mime: string) => boolean;
  withSpeechRecognition?: boolean;
  online?: boolean;
  getUserMediaError?: Error;
}) {
  const sampleRate = opts.sampleRate ?? 48_000;
  let capturedProcessor: {
    onaudioprocess: ((ev: AudioProcessingEvent) => void) | null;
  } | null = null;
  let capturedRecognition: SpeechRecognitionLike | null = null;
  let tracksStopped = 0;
  let mockRecorderInstance: {
    state: string;
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null;
    onstop: ((e: Event) => void) | null;
    start: () => void;
    stop: () => void;
    requestData: () => void;
    chunksEmitted: Blob[];
  } | null = null;

  const mockStream = {
    getTracks: () => [
      {
        stop: () => {
          tracksStopped++;
        },
      },
    ],
  } as unknown as MediaStream;

  const envDeps = {
    getNavigator: () => ({
      onLine: opts.online !== false,
      mediaDevices: {
        getUserMedia: async () => {
          if (opts.getUserMediaError) throw opts.getUserMediaError;
          return mockStream;
        },
      },
    }),
    createAudioContext:
      opts.withAudioContext === false
        ? () => null
        : () =>
            ({
              sampleRate,
              state: 'suspended',
              resume: async () => {},
              close: async () => {},
              destination: {} as AudioDestinationNode,
              createMediaStreamSource: () => ({
                connect: () => {},
                disconnect: () => {},
              }),
              createScriptProcessor: () => {
                capturedProcessor = { onaudioprocess: null };
                return {
                  connect: () => {},
                  disconnect: () => {},
                  set onaudioprocess(fn: ((ev: AudioProcessingEvent) => void) | null) {
                    capturedProcessor!.onaudioprocess = fn;
                  },
                  get onaudioprocess() {
                    return capturedProcessor!.onaudioprocess;
                  },
                };
              },
              createGain: () => ({
                gain: { value: 1 },
                connect: () => {},
                disconnect: () => {},
              }),
            }) as unknown as AudioContext,
    isMimeTypeSupported: opts.mimeSupported,
    createMediaRecorder:
      opts.withMediaRecorder === false
        ? undefined
        : (_stream: MediaStream, options?: MediaRecorderOptions) => {
            mockRecorderInstance = {
              state: 'inactive',
              mimeType: options?.mimeType || 'audio/webm',
              ondataavailable: null,
              onstop: null,
              chunksEmitted: [],
              start: () => {
                mockRecorderInstance!.state = 'recording';
              },
              requestData: () => {
                const tailBlob = new Blob([new Uint8Array(600).fill(42)], {
                  type: mockRecorderInstance!.mimeType,
                });
                mockRecorderInstance!.chunksEmitted.push(tailBlob);
                mockRecorderInstance!.ondataavailable?.({ data: tailBlob });
              },
              stop: () => {
                mockRecorderInstance!.state = 'inactive';
                mockRecorderInstance!.onstop?.(new Event('stop'));
              },
            };
            return mockRecorderInstance as unknown as MediaRecorder;
          },
    createSpeechRecognition:
      opts.withSpeechRecognition === false
        ? () => null
        : () => {
            capturedRecognition = {
              lang: 'ur-PK',
              continuous: true,
              interimResults: true,
              maxAlternatives: 1,
              onresult: null,
              onerror: null,
              onend: null,
              start: () => {},
              stop: () => {
                capturedRecognition?.onend?.();
              },
              abort: () => {},
            };
            return capturedRecognition;
          },
  };

  return {
    envDeps,
    pushAudioSeconds: (sec: number, amplitude = 0.25) => {
      const f32 = makePcmBuffer(sec, sampleRate, amplitude);
      // Emit in realistic 4096-sample WebAudio blocks so windowing logic runs naturally
      for (let off = 0; off < f32.length; off += 4096) {
        const block = f32.subarray(off, Math.min(off + 4096, f32.length));
        capturedProcessor?.onaudioprocess?.({
          inputBuffer: {
            getChannelData: () => block,
          },
        } as unknown as AudioProcessingEvent);
      }
    },
    pushRecognitionResult: (tokens: Array<{ text: string; isFinal: boolean }>) => {
      capturedRecognition?.onresult?.({
        resultIndex: 0,
        results: tokens.map((t) => ({
          isFinal: t.isFinal,
          0: { transcript: t.text },
          length: 1,
        })),
      });
    },
    triggerRecognitionError: (error: string) => {
      capturedRecognition?.onerror?.({ error });
    },
    triggerRecognitionEnd: () => {
      capturedRecognition?.onend?.();
    },
    getTracksStoppedCount: () => tracksStopped,
    getMockRecorder: () => mockRecorderInstance,
    hasRecognition: () => Boolean(capturedRecognition),
  };
}

async function run(): Promise<void> {
  const realFetch = globalThis.fetch;
  let passed = 0;

  try {
    // =========================================================================
    // Scenario 1: Short spoken sentence + valid 16kHz RIFF WAV + real /api/stt
    // =========================================================================
    resetGeminiEnv();
    {
      const capturedUrls: string[] = [];
      globalThis.fetch = async (input) => {
        capturedUrls.push(String(input));
        return makeGeminiOk('آج گندم کو پانی کب دیں');
      };

      const harness = createMockAudioEnv({ withSpeechRecognition: true });
      const partials: Array<{ text: string; isFinal: boolean; atMs: number }> = [];
      let ended = false;
      const startedAt = Date.now();

      const session = createFieldSpeechCapture(
        'ur',
        {
          onResult: (transcript, isFinal) =>
            partials.push({ text: transcript, isFinal, atMs: Date.now() - startedAt }),
          onError: (e) => assert.fail(`Unexpected error: ${e}`),
          onEnd: () => {
            ended = true;
          },
          hints: ['گندم'],
        },
        {
          ...harness.envDeps,
          fetchFn: async (_url, init) => {
            const form = init?.body as FormData;
            const file = form.get('audio') as Blob;
            const bytes = new Uint8Array(await file.arrayBuffer());
            // Verify real 16kHz PCM RIFF/WAVE header!
            assert.equal(Buffer.from(bytes.slice(0, 4)).toString('ascii'), 'RIFF');
            assert.equal(Buffer.from(bytes.slice(8, 12)).toString('ascii'), 'WAVE');
            const req = new NextRequest('http://localhost:3000/api/stt', {
              method: 'POST',
              body: form,
            });
            return sttRoutePost(req);
          },
        }
      );

      assert.ok(session);
      await new Promise((r) => setTimeout(r, 20));
      harness.pushRecognitionResult([{ text: 'آج گندم کو', isFinal: false }]);
      harness.pushAudioSeconds(1.1, 0.3);
      session.stop();

      while (!ended) await new Promise((r) => setTimeout(r, 10));

      assert.ok(partials.length >= 2, 'Should emit progressive partial + final transcript');
      assert.equal(partials[0].isFinal, false);
      assert.ok(partials[0].atMs < 350, `First partial took ${partials[0].atMs}ms (expected <350ms)`);
      const finalEvent = partials[partials.length - 1];
      assert.equal(finalEvent.isFinal, true);
      assert.equal(finalEvent.text, 'آج گندم کو پانی کب دیں');
      assert.equal(harness.getTracksStoppedCount(), 1);
      passed++;
      console.log(
        `✓ Scenario 1 passed: Short sentence (<350ms first partial: ${partials[0].atMs}ms) + tail WAV flush`
      );
    }

    // =========================================================================
    // Scenario 2: Long 30-second continuous sentence (no 18s cutoff!)
    // =========================================================================
    resetGeminiEnv();
    {
      let chunkUploads = 0;
      const harness = createMockAudioEnv({ withSpeechRecognition: false });
      const updates: Array<{ text: string; isFinal: boolean }> = [];
      let ended = false;

      const chunkTranscripts = [
        'کسان بھائی میں اپنی دس ایکڑ گندم کے بارے میں پوچھ رہا ہوں',
        'پوچھ رہا ہوں کہ پہلے پانی کے ساتھ کتنی یوریا اور ڈی اے پی کھاد ڈالوں',
        'اور ڈی اے پی کھاد ڈالوں کیونکہ پتوں کی نوک ہلکی پیلی ہو رہی ہے',
        'پیلی ہو رہی ہے اور موسم بھی اس ہفتے کافی خشک رہنے کا امکان ہے',
        'امکان ہے اس لیے مجھے فی ایکڑ درست مقدار اور اسپرے کا وقت بتا دیں',
        'وقت بتا دیں تاکہ فصل کی بڑھوتری اچھی ہو اور پیداوار کم نہ ہو',
        'پیداوار کم نہ ہو شکریہ زرخیز مشیر',
        'شکریہ زرخیز مشیر مہربانی',
      ];

      const session = createFieldSpeechCapture(
        'ur',
        {
          onResult: (text, isFinal) => updates.push({ text, isFinal }),
          onError: (e) => assert.fail(`Unexpected error in 30s test: ${e}`),
          onEnd: () => {
            ended = true;
          },
        },
        {
          ...harness.envDeps,
          fetchFn: async () => {
            const idx = Math.min(chunkUploads++, chunkTranscripts.length - 1);
            return new Response(
              JSON.stringify({
                transcript: chunkTranscripts[idx],
                localeCode: 'ur-PK',
                provider: 'gemini-audio-stt',
                latencyMs: 35,
              }),
              { status: 200 }
            );
          },
        }
      );

      assert.ok(session);
      await new Promise((r) => setTimeout(r, 20));
      for (let sec = 0; sec < 30; sec += 2) {
        harness.pushAudioSeconds(2, 0.25);
        await new Promise((r) => setTimeout(r, 10));
      }
      session.stop();
      while (!ended) await new Promise((r) => setTimeout(r, 10));

      const progressiveCount = updates.filter((u) => !u.isFinal).length;
      const finalText = updates[updates.length - 1]?.text || '';
      assert.ok(chunkUploads >= 7, `Expected >=7 incremental windows over 30s, got ${chunkUploads}`);
      assert.ok(progressiveCount >= 5, `Expected progressive updates before stop, got ${progressiveCount}`);
      assert.ok(finalText.includes('دس ایکڑ گندم'), 'Start of 30s speech preserved');
      assert.ok(finalText.includes('پیداوار کم نہ ہو'), 'End of 30s speech preserved past 18s');
      assert.equal(finalText.match(/پیلی ہو رہی ہے/g)?.length, 1, 'Overlap deduplicated cleanly');
      passed++;
      console.log(
        `✓ Scenario 2 passed: 30s continuous capture (${chunkUploads} chunks, ${progressiveCount} live updates, zero 18s cutoff)`
      );
    }

    // =========================================================================
    // Scenario 3: Long 60-second speech + Out-of-order HTTP chunk arrival
    // =========================================================================
    {
      const buffer = new OrderedChunkTranscriptBuffer();
      // Simulate chunk 2 arriving before chunk 0 and chunk 1 (network jitter!)
      const r2 = buffer.acceptChunk(2, 'اور تیسری کھاد پچاس کلو پوٹاش شامل کریں');
      assert.equal(r2.committedText, '', 'Chunk 2 must wait while 0 and 1 are pending');
      assert.equal(r2.hasGap, true);

      const r0 = buffer.acceptChunk(0, 'ساٹھ سیکنڈ کی گفتگو میں پہلے زمین تیار کریں');
      assert.equal(r0.committedText, 'ساٹھ سیکنڈ کی گفتگو میں پہلے زمین تیار کریں');
      assert.equal(r0.hasGap, true);

      const r1 = buffer.acceptChunk(1, 'زمين تیار کریں پھر دو بوری ڈی اے پی اور تیسری کھاد');
      assert.equal(r1.hasGap, false);
      // Merge verified chunk 0 -> 1 -> 2 in strict order without scrambling sentences!
      assert.ok(r1.committedText.startsWith('ساٹھ سیکنڈ'));
      assert.ok(r1.committedText.includes('دو بوری ڈی اے پی'));
      assert.ok(r1.committedText.endsWith('پچاس کلو پوٹاش شامل کریں'));
      passed++;
      console.log('✓ Scenario 3 passed: 60s out-of-order chunks sequenced strictly in spoken order');
    }

    // =========================================================================
    // Scenario 4: Slow speech with natural 4-second silent pause (no premature stop)
    // =========================================================================
    resetGeminiEnv();
    {
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        const textPart = body?.contents?.[0]?.parts?.[1]?.text || '';
        assert.ok(textPart.includes('[NO_SPEECH]'));
        // Even if Gemini returns [NO_SPEECH] for a quiet window, route returns 200 { transcript: "" }
        return makeGeminiOk('[NO_SPEECH]');
      };

      const wavSil = encodeMonoPcm16ToWavBytes(new Int16Array(16000), 16000);
      const fd = new FormData();
      fd.append('audio', new Blob([wavSil], { type: 'audio/wav' }), 'pause.wav');
      fd.append('lang', 'ur');
      const noSpeechRes = await sttRoutePost(
        new NextRequest('http://localhost:3000/api/stt', { method: 'POST', body: fd })
      );
      assert.equal(noSpeechRes.status, 200, '[NO_SPEECH] pause window must return HTTP 200 not 502 error');
      const noSpeechJson = (await noSpeechRes.json()) as { transcript: string };
      assert.equal(noSpeechJson.transcript, '');

      // Client side: 4s silence window between two spoken segments keeps capture alive
      const harness = createMockAudioEnv({ withSpeechRecognition: false });
      const sentPayloads: number[] = [];
      let ended = false;
      let finalTx = '';
      const session = createFieldSpeechCapture(
        'ur',
        {
          onResult: (tx, isFinal) => {
            if (isFinal) finalTx = tx;
          },
          onError: (e) => assert.fail(`Pause should not trigger error: ${e}`),
          onEnd: () => {
            ended = true;
          },
        },
        {
          ...harness.envDeps,
          fetchFn: async () => {
            const idx = sentPayloads.length;
            sentPayloads.push(idx);
            const map = ['کپاس کی فصل پر', '', 'سفید مکھی کا حملہ ہے'];
            return new Response(JSON.stringify({ transcript: map[idx] ?? '' }), { status: 200 });
          },
        }
      );

      assert.ok(session);
      await new Promise((r) => setTimeout(r, 20));
      // 13.1s total clip with an 8s silent pause in the middle:
      // window #0 flushes speech 1, window #1 rescues 0.12s speech tail (+[NO_SPEECH] / empty),
      // window #2 (pure 3.6s digital silence) is skipped cleanly, final flush captures speech 2!
      harness.pushAudioSeconds(2.6, 0.25);
      await new Promise((r) => setTimeout(r, 15));
      harness.pushAudioSeconds(8.0, 0);
      await new Promise((r) => setTimeout(r, 15));
      harness.pushAudioSeconds(2.5, 0.25);
      session.stop();
      while (!ended) await new Promise((r) => setTimeout(r, 10));

      assert.equal(ended, true);
      assert.equal(finalTx, 'کپاس کی فصل پر سفید مکھی کا حملہ ہے');
      assert.equal(sentPayloads.length, 3, 'Expected pure silence pause window to be skipped (3 uploads instead of 4)');
      passed++;
      console.log('✓ Scenario 4 passed: 4s natural pause kept session alive + [NO_SPEECH] handled cleanly');
    }

    // =========================================================================
    // Scenario 5: Fast speech across overlap boundaries (zero dropped/duped boundary words)
    // =========================================================================
    {
      const mergedFast = mergeTranscriptWithOverlap(
        'گندم کی فصل کو پہلا پانی اکیس دن بعد',
        'پانی اکیس دن بعد لگانا بہتر ہوتا ہے اور یوریا ساتھ دیں'
      );
      assert.equal(
        mergedFast,
        'گندم کی فصل کو پہلا پانی اکیس دن بعد لگانا بہتر ہوتا ہے اور یوریا ساتھ دیں'
      );
      passed++;
      console.log('✓ Scenario 5 passed: Fast speech overlap boundary merged cleanly without duplication');
    }

    // =========================================================================
    // Scenario 6: Urdu speech fidelity + prompt preservation (never translate)
    // =========================================================================
    resetGeminiEnv();
    {
      let sentPrompt = '';
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        sentPrompt = body?.contents?.[0]?.parts?.[1]?.text || '';
        return makeGeminiOk('گندم میں پیلا کنگی کا اسپرے بتائیں');
      };

      const wav = encodeMonoPcm16ToWavBytes(downsampleFloat32ToInt16(makePcmBuffer(0.5, 16000), 16000));
      const fd = new FormData();
      fd.append('audio', new Blob([wav], { type: 'audio/wav' }), 'urdu.wav');
      fd.append('lang', 'ur');
      fd.append('hints', 'کنگی,یوریا');
      fd.append('previousContext', 'پچھلا سوال');

      const res = await sttRoutePost(
        new NextRequest('http://localhost:3000/api/stt', { method: 'POST', body: fd })
      );
      assert.equal(res.status, 200);
      const data = (await res.json()) as { transcript: string; localeCode: string; provider: string };
      assert.equal(data.transcript, 'گندم میں پیلا کنگی کا اسپرے بتائیں');
      assert.equal(data.localeCode, 'ur-PK');
      assert.equal(data.provider, 'gemini-audio-stt');
      assert.ok(sentPrompt.includes('NEVER translate Urdu into English'));
      assert.ok(sentPrompt.includes('کنگی'));
      assert.ok(sentPrompt.includes('پچھلا سوال'));
      passed++;
      console.log('✓ Scenario 6 passed: Urdu speech preserved verbatim with lexicon + prior context');
    }

    // =========================================================================
    // Scenario 7: Sindhi speech (ڀ ٻ ڄ ڪ ڳ ڱ) + distinct ڪ vs ک overlap preservation
    // =========================================================================
    resetGeminiEnv();
    {
      let sentPrompt = '';
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        sentPrompt = body?.contents?.[0]?.parts?.[1]?.text || '';
        return makeGeminiOk('ڪڻڪ جي فصل کي ڀاڻ ڪڏهن ڏجي ۽ ڳاڙهو مرض ڪيئن روڪجي');
      };

      const harness = createMockAudioEnv({ withSpeechRecognition: true });
      let finalSd = '';
      let ended = false;
      const session = createFieldSpeechCapture(
        'sd',
        {
          onResult: (tx, isFinal) => {
            if (isFinal) finalSd = tx;
          },
          onError: (e) => assert.fail(`Unexpected error in Sindhi test: ${e}`),
          onEnd: () => {
            ended = true;
          },
        },
        {
          ...harness.envDeps,
          fetchFn: async (_url, init) =>
            sttRoutePost(
              new NextRequest('http://localhost:3000/api/stt', {
                method: 'POST',
                body: init?.body as FormData,
              })
            ),
        }
      );

      assert.ok(session);
      await new Promise((r) => setTimeout(r, 20));
      // Sindhi deliberately avoids WebSpeech overlay coercion so recognition stays pure Sindhi
      assert.equal(harness.hasRecognition(), false);
      harness.pushAudioSeconds(0.7, 0.25);
      session.stop();
      while (!ended) await new Promise((r) => setTimeout(r, 10));

      assert.ok(finalSd.includes('ڪڻڪ'));
      assert.ok(finalSd.includes('ڀاڻ'));
      assert.ok(finalSd.includes('ڳاڙهو'));
      assert.ok(sentPrompt.includes('Pakistani Sindhi'));
      assert.ok(sentPrompt.includes('NEVER translate Sindhi'));
      // Verify ڪ (U+06AA) and ک (U+06A9) are not falsely merged as identical tokens
      assert.equal(mergeTranscriptWithOverlap('ڪم', 'کم'), 'ڪم کم');
      passed++;
      console.log('✓ Scenario 7 passed: Sindhi Arabic letters + script integrity preserved verbatim');
    }

    // =========================================================================
    // Scenario 8 & 9: English & Mixed Urdu/English + Agricultural Terminology (10)
    // =========================================================================
    resetGeminiEnv();
    {
      // Scenario 8: Pure English
      globalThis.fetch = async () =>
        makeGeminiOk('Apply 50 kg DAP per acre before sowing wheat in Multan');
      const wavEn = encodeMonoPcm16ToWavBytes(new Int16Array(8000).fill(500));
      const fdEn = new FormData();
      fdEn.append('audio', new Blob([wavEn], { type: 'audio/wav' }), 'en.wav');
      fdEn.append('lang', 'en');
      const enRes = await (
        await sttRoutePost(new NextRequest('http://localhost:3000/api/stt', { method: 'POST', body: fdEn }))
      ).json();
      assert.equal(enRes.localeCode, 'en-PK');
      assert.ok(enRes.transcript.includes('50 kg DAP per acre'));

      // Scenario 9 & 10: Mixed Urdu + English + Ag Technical Terminology verbatim
      globalThis.fetch = async () =>
        makeGeminiOk('گندم میں DAP اور Urea کے ساتھ Imidacloprid 200 ml فی ایکڑ استعمال کریں');
      const fdMix = new FormData();
      fdMix.append('audio', new Blob([wavEn], { type: 'audio/wav' }), 'mix.wav');
      fdMix.append('lang', 'ur');
      const mixRes = await (
        await sttRoutePost(new NextRequest('http://localhost:3000/api/stt', { method: 'POST', body: fdMix }))
      ).json();
      assert.ok(mixRes.transcript.includes('DAP'));
      assert.ok(mixRes.transcript.includes('Urea'));
      assert.ok(mixRes.transcript.includes('Imidacloprid 200 ml'));
      assert.ok(mixRes.transcript.includes('گندم میں'));
      passed += 3;
      console.log('✓ Scenarios 8, 9 & 10 passed: English, mixed Urdu+English, and ag terms intact verbatim');
    }

    // =========================================================================
    // Scenario 11: Immediate stop right after last word (tail chunk flushed!)
    // =========================================================================
    {
      const harness = createMockAudioEnv({ withSpeechRecognition: false });
      const uploadedLengths: number[] = [];
      let finalOut = '';
      let ended = false;

      const session = createFieldSpeechCapture(
        'ur',
        {
          onResult: (tx, isFinal) => {
            if (isFinal) finalOut = tx;
          },
          onError: (e) => assert.fail(e),
          onEnd: () => {
            ended = true;
          },
        },
        {
          ...harness.envDeps,
          fetchFn: async (_url, init) => {
            const form = init?.body as FormData;
            const file = form.get('audio') as Blob;
            uploadedLengths.push(file.size);
            const idx = uploadedLengths.length - 1;
            const text = idx === 0 ? 'فصل کو کیڑا لگ گیا' : 'کیڑا لگ گیا ہے فوراً بتائیں';
            return new Response(JSON.stringify({ transcript: text }), { status: 200 });
          },
        }
      );

      assert.ok(session);
      await new Promise((r) => setTimeout(r, 20));
      harness.pushAudioSeconds(2.6, 0.25); // triggers window 0
      await new Promise((r) => setTimeout(r, 20));
      harness.pushAudioSeconds(0.24, 0.3); // short final spoken tail right before Stop
      session.stop();
      while (!ended) await new Promise((r) => setTimeout(r, 10));

      assert.equal(uploadedLengths.length, 2, 'Short 240ms final word must be flushed on immediate Stop');
      assert.equal(finalOut, 'فصل کو کیڑا لگ گیا ہے فوراً بتائیں');
      passed++;
      console.log('✓ Scenario 11 passed: Immediate stop preserved 240ms tail word completely');
    }

    // =========================================================================
    // Scenario 12: Consecutive recordings in same input preserving typed prefix
    // =========================================================================
    {
      const typedBefore = 'سلام زرخیز:';
      const firstRecording = computeIncrementalInputValue(typedBefore, 'گندم کا ریٹ بتائیں');
      assert.equal(firstRecording, 'سلام زرخیز: گندم کا ریٹ بتائیں');

      // Live interim during 2nd recording must preserve both typed text and recording #1!
      const secondInterim = computeIncrementalInputValue(firstRecording, 'اور یوریا');
      assert.equal(secondInterim, 'سلام زرخیز: گندم کا ریٹ بتائیں اور یوریا');

      const secondFinal = computeIncrementalInputValue(firstRecording, 'اور یوریا کی قیمت بھی');
      assert.equal(secondFinal, 'سلام زرخیز: گندم کا ریٹ بتائیں اور یوریا کی قیمت بھی');
      passed++;
      console.log('✓ Scenario 12 passed: Consecutive recordings append cleanly without clobbering typed text');
    }

    // =========================================================================
    // Scenario 13: Microphone permission denied, not found, and busy classification
    // =========================================================================
    {
      assert.equal(classifyMicrophoneError(new DOMException('Denied', 'NotAllowedError')), 'mic_permission_denied');
      assert.equal(classifyMicrophoneError(new DOMException('No device', 'NotFoundError')), 'mic_not_found');
      assert.equal(classifyMicrophoneError(new DOMException('Busy', 'NotReadableError')), 'mic_busy');

      const deniedEnv = createMockAudioEnv({
        getUserMediaError: new DOMException('Permission denied', 'NotAllowedError'),
      });
      const gotErrors: string[] = [];
      let ended = false;
      createFieldSpeechCapture(
        'ur',
        {
          onResult: () => {},
          onError: (e) => gotErrors.push(e),
          onEnd: () => {
            ended = true;
          },
        },
        deniedEnv.envDeps
      );
      while (!ended) await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(gotErrors, ['mic_permission_denied']);
      passed++;
      console.log('✓ Scenario 13 passed: Mic permission/hardware errors cleanly classified & isolated from API errors');
    }

    // =========================================================================
    // Scenario 14: Network disconnect mid-capture rescues preview text safely
    // =========================================================================
    {
      let navigatorOnline = true;
      const harness = createMockAudioEnv({ withSpeechRecognition: true });
      let finalSaved = '';
      const errors: string[] = [];
      let ended = false;

      const session = createFieldSpeechCapture(
        'ur',
        {
          onResult: (tx, isFinal) => {
            if (isFinal) finalSaved = tx;
          },
          onError: (e) => errors.push(e),
          onEnd: () => {
            ended = true;
          },
        },
        {
          ...harness.envDeps,
          getNavigator: () => ({
            ...harness.envDeps.getNavigator(),
            onLine: navigatorOnline,
          }),
          fetchFn: async () => {
            navigatorOnline = false;
            throw new TypeError('Failed to fetch');
          },
        }
      );

      assert.ok(session);
      await new Promise((r) => setTimeout(r, 20));
      harness.pushRecognitionResult([{ text: 'نیٹ بند ہونے سے پہلے کا جملہ', isFinal: true }]);
      harness.pushAudioSeconds(0.9, 0.25);
      session.stop();
      while (!ended) await new Promise((r) => setTimeout(r, 10));

      assert.equal(finalSaved, 'نیٹ بند ہونے سے پہلے کا جملہ', 'Rescued partial transcript instead of erasing!');
      assert.deepEqual(errors, ['network_offline']);
      passed++;
      console.log('✓ Scenario 14 passed: Network drop mid-session preserved spoken text & emitted network_offline');
    }

    // =========================================================================
    // Scenario 15: Gemini Timeout + HTTP 404 Model Cascade + 5-Account Failover
    // =========================================================================
    resetGeminiEnv();
    {
      // Part A: HTTP 404 on GEMINI_MODEL_FAST must cascade to gemini-flash-lite-latest on Account 1 WITHOUT burning slots!
      process.env.GEMINI_MODEL_FAST = 'gemini-retired-404';
      const seenA: Array<{ slot: number; model: string }> = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        const model = getModelFromUrl(String(input));
        seenA.push({ slot, model });
        if (model === 'gemini-retired-404') {
          return new Response('Model not found', { status: 404 });
        }
        return makeGeminiOk('کھیت کی مٹی چیک کروائیں');
      };

      const wav = encodeMonoPcm16ToWavBytes(new Int16Array(8000).fill(400));
      const fdA = new FormData();
      fdA.append('audio', new Blob([wav], { type: 'audio/wav' }), 'test.wav');
      fdA.append('lang', 'ur');
      const resA = await sttRoutePost(
        new NextRequest('http://localhost:3000/api/stt', { method: 'POST', body: fdA })
      );
      assert.equal(resA.status, 200);
      const jsonA = (await resA.json()) as { transcript: string; modelUsed?: string; failoverSteps?: number };
      assert.equal(jsonA.transcript, 'کھیت کی مٹی چیک کروائیں');
      assert.equal(jsonA.modelUsed, 'gemini-flash-lite-latest');
      assert.equal(jsonA.failoverSteps, 0, '404 model cascade stayed on healthy Account 1!');
      assert.deepEqual(seenA, [
        { slot: 1, model: 'gemini-retired-404' },
        { slot: 1, model: 'gemini-flash-lite-latest' },
      ]);
      // Confirm Account 1 remained ACTIVE (not marked unavailable on 404!)
      assert.equal(getGeminiPoolHealthSnapshot().slots[0].status, 'active');

      // Part B: Account 1 timeout -> Account 2 failover preserves prompt/audio/previousContext
      resetGeminiEnv();
      const failoverSlots: number[] = [];
      globalThis.fetch = async (input) => {
        const slot = getSlotFromUrl(String(input));
        failoverSlots.push(slot);
        if (slot === 1) {
          const timeoutErr = new Error('The operation was aborted due to timeout');
          timeoutErr.name = 'TimeoutError';
          throw timeoutErr;
        }
        return makeGeminiOk('سربراہ اکاؤنٹ دو سے درست جواب');
      };
      const fdB = new FormData();
      fdB.append('audio', new Blob([wav], { type: 'audio/wav' }), 'failover.wav');
      fdB.append('lang', 'ur');
      fdB.append('previousContext', 'پچھلا جملہ');
      const resB = await sttRoutePost(
        new NextRequest('http://localhost:3000/api/stt', { method: 'POST', body: fdB })
      );
      assert.equal(resB.status, 200);
      const jsonB = (await resB.json()) as { transcript: string; failoverSteps?: number };
      assert.equal(jsonB.transcript, 'سربراہ اکاؤنٹ دو سے درست جواب');
      assert.equal(jsonB.failoverSteps, 1);
      assert.deepEqual(failoverSlots, [1, 2]);

      // Part C: All 5 accounts time out -> 504 stt_timeout without leaking keys
      resetGeminiEnv();
      globalThis.fetch = async () => {
        const timeoutErr = new Error(`Timeout calling ${TEST_KEYS[0]}`);
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      };
      const fdC = new FormData();
      fdC.append('audio', new Blob([wav], { type: 'audio/wav' }), 'timeout.wav');
      const resC = await sttRoutePost(
        new NextRequest('http://localhost:3000/api/stt', { method: 'POST', body: fdC })
      );
      assert.equal(resC.status, 504);
      const errText = await resC.text();
      assert.ok(errText.includes('stt_timeout'));
      for (const key of TEST_KEYS) {
        assert.equal(errText.includes(key), false, 'API keys must never appear in HTTP error responses');
        assert.equal(redactSecrets(errText).includes(key), false);
      }
      passed++;
      console.log('✓ Scenario 15 passed: 404 model cascade + 5-account STT failover + 504 timeout + zero key leaks');
    }

    // =========================================================================
    // Scenario 16: MIME capability selection + Android dual-mic conflict recovery
    // =========================================================================
    {
      const chromeMime = pickSupportedAudioMimeType((m) => m === 'audio/webm;codecs=opus');
      assert.deepEqual(chromeMime, {
        mimeType: 'audio/webm;codecs=opus',
        cleanMimeType: 'audio/webm',
        ext: 'webm',
      });
      const iosSafariMime = pickSupportedAudioMimeType((m) => m === 'audio/mp4');
      assert.deepEqual(iosSafariMime, {
        mimeType: 'audio/mp4',
        cleanMimeType: 'audio/mp4',
        ext: 'mp4',
      });
      const firefoxMime = pickSupportedAudioMimeType((m) => m === 'audio/ogg;codecs=opus');
      assert.deepEqual(firefoxMime, {
        mimeType: 'audio/ogg;codecs=opus',
        cleanMimeType: 'audio/ogg',
        ext: 'ogg',
      });
      const legacyMime = pickSupportedAudioMimeType(() => false);
      assert.equal(legacyMime.mimeType, '');

      // Simulate Android simultaneous SpeechRecognition conflict ('audio-capture'):
      // preview overlay silently backs off while PCM -> Gemini WAV still captures 100%!
      const androidEnv = createMockAudioEnv({ withSpeechRecognition: true });
      const gotErrors: string[] = [];
      let androidFinal = '';
      let ended = false;
      const session = createFieldSpeechCapture(
        'ur',
        {
          onResult: (tx, isFinal) => {
            if (isFinal) androidFinal = tx;
          },
          onError: (e) => gotErrors.push(e),
          onEnd: () => {
            ended = true;
          },
        },
        {
          ...androidEnv.envDeps,
          fetchFn: async () =>
            new Response(JSON.stringify({ transcript: 'اینڈرائیڈ مائیک بیک اپ مکمل' }), { status: 200 }),
        }
      );
      assert.ok(session);
      await new Promise((r) => setTimeout(r, 20));
      androidEnv.triggerRecognitionError('audio-capture'); // Conflict on preview overlay
      androidEnv.pushAudioSeconds(0.8, 0.25);
      session.stop();
      while (!ended) await new Promise((r) => setTimeout(r, 10));

      assert.equal(gotErrors.length, 0, 'Android overlay conflict must NOT abort primary audio capture');
      assert.equal(androidFinal, 'اینڈرائیڈ مائیک بیک اپ مکمل');
      passed++;
      console.log('✓ Scenario 16 passed: Cross-browser MIME detection + Android dual-mic conflict auto-recovery');
    }

    // =========================================================================
    // Scenario 17: MediaRecorder fallback (no AudioContext) & Fixed Web Speech fallback
    // =========================================================================
    {
      // Case A: AudioContext absent (falls back cleanly to MediaRecorder + requestData flush)
      const mrEnv = createMockAudioEnv({
        withAudioContext: false,
        withMediaRecorder: true,
        mimeSupported: (m) => m === 'audio/mp4',
        withSpeechRecognition: false,
      });
      let mrFinal = '';
      let mrEnded = false;
      const mrSession = createFieldSpeechCapture(
        'en',
        {
          onResult: (tx, isFinal) => {
            if (isFinal) mrFinal = tx;
          },
          onError: (e) => assert.fail(e),
          onEnd: () => {
            mrEnded = true;
          },
        },
        {
          ...mrEnv.envDeps,
          fetchFn: async (_url, init) => {
            const form = init?.body as FormData;
            const f = form.get('audio') as Blob & { name?: string };
            assert.equal(f.type, 'audio/mp4');
            assert.ok(String(f.name).endsWith('.mp4'));
            return new Response(JSON.stringify({ transcript: 'Wheat rust advice' }), { status: 200 });
          },
        }
      );
      assert.ok(mrSession);
      await new Promise((r) => setTimeout(r, 25));
      mrSession.stop();
      while (!mrEnded) await new Promise((r) => setTimeout(r, 10));
      assert.equal(mrFinal, 'Wheat rust advice');

      // Case B: Offline / getUserMedia absent -> pause-tolerant fixed WebSpeech (auto-restarts cleanly!)
      const wsEnv = createMockAudioEnv({ withSpeechRecognition: true });
      let wsInterim = '';
      let wsFinal = '';
      let wsEnded = false;
      const wsSession = startFixedBrowserSpeechRecognition(
        'ur',
        {
          onResult: (tx, isFinal) => {
            if (isFinal) wsFinal = tx;
            else wsInterim = tx;
          },
          onError: (e) => assert.fail(e),
          onEnd: () => {
            wsEnded = true;
          },
        },
        wsEnv.envDeps
      );
      assert.ok(wsSession);
      wsEnv.pushRecognitionResult([{ text: 'پہلا جملہ', isFinal: true }]);
      // Simulate Chrome idle close after 8s pause — must restart automatically without losing text!
      wsEnv.triggerRecognitionEnd();
      await new Promise((r) => setTimeout(r, 160));
      assert.equal(wsEnded, false, 'WebSpeech must tolerate idle pause restarts until user clicks Stop');
      wsEnv.pushRecognitionResult([{ text: 'دوسرا جملہ', isFinal: true }]);
      wsSession.stop();
      while (!wsEnded) await new Promise((r) => setTimeout(r, 10));
      assert.equal(wsInterim, 'پہلا جملہ دوسرا جملہ');
      assert.equal(wsFinal, 'پہلا جملہ دوسرا جملہ');

      // Case C: Completely unsupported browser emits clean error
      const unsupErrors: string[] = [];
      let unsupEnded = false;
      const resUnsup = startFixedBrowserSpeechRecognition(
        'ur',
        {
          onResult: () => {},
          onError: (e) => unsupErrors.push(e),
          onEnd: () => {
            unsupEnded = true;
          },
        },
        { createSpeechRecognition: () => null }
      );
      assert.equal(resUnsup, null);
      assert.equal(unsupEnded, true);
      assert.deepEqual(unsupErrors, ['recognition_unsupported']);
      passed++;
      console.log('✓ Scenario 17 passed: MediaRecorder .mp4 fallback + pause-tolerant WebSpeech + unsupported error');
    }

    // =========================================================================
    // Scenario 18: Dedicated STT Rate Limit (80/10m vs 20/10m) & Live Display Composition
    // =========================================================================
    {
      // Confirm live preview composition stitches committed server words cleanly with new preview tail
      const composed = composeDisplayTranscript(
        'آج گندم کو پانی',
        'آج گندم کو پانی اور یوریا دینا ہے',
        4
      );
      assert.equal(composed, 'آج گندم کو پانی اور یوریا دینا ہے');

      // Confirm 25 incremental STT calls for one farmer IP pass 'stt' limit while 'chat' default stays 20
      const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
      for (let i = 0; i < 25; i++) {
        const r = await checkRateLimit(testIp, { maxRequests: 80, namespace: 'stt' });
        assert.equal(r.success, true, `STT chunk ${i + 1}/25 should stay under 80 limit`);
      }
      // Chat default namespace for the SAME IP must still have full 20 capacity!
      const chatRes = await checkRateLimit(testIp);
      assert.equal(chatRes.success, true);
      assert.equal(chatRes.remaining, 19);

      // Verify PCM normalization utility bounds
      const rmsCheck = computePcm16RmsAndPeak(new Int16Array([0, 16384, -16384]));
      assert.ok(rmsCheck.peak >= 0.49 && rmsCheck.rms > 0.3);
      assert.equal(normalizeSttSegment('  [NO_SPEECH]  '), '');
      passed++;
      console.log('✓ Scenario 18 passed: Live overlay stitching, 80/10m STT rate budget, and signal bounds');
    }

    // =========================================================================
    // Scenario 19: Stop During Pending getUserMedia Permission Finalizes Cleanly & Releases Late Tracks
    // =========================================================================
    {
      let resolvePerm!: (stream: MediaStream) => void;
      let stoppedLateTracks = 0;
      let endCalls = 0;
      const statuses: string[] = [];

      const delayedStream = {
        getTracks: () => [
          {
            stop: () => {
              stoppedLateTracks++;
            },
          },
        ],
      } as unknown as MediaStream;

      const session = createFieldSpeechCapture(
        'ur',
        {
          onResult: () => {},
          onError: () => {},
          onStatusChange: (s) => statuses.push(s),
          onEnd: () => {
            endCalls++;
          },
        },
        {
          getNavigator: () => ({
            onLine: true,
            mediaDevices: {
              getUserMedia: () =>
                new Promise<MediaStream>((resolve) => {
                  resolvePerm = resolve;
                }),
            } as unknown as MediaDevices,
          }),
          fetchFn: (async () => new Response('{}', { status: 200 })) as typeof fetch,
        }
      );

      assert.ok(session);
      session!.stop();
      await new Promise((r) => setTimeout(r, 170));
      assert.equal(endCalls, 1, 'Stop while awaiting permission must finalize without hanging UI');
      assert.equal(statuses[statuses.length - 1], 'idle');

      // Permission resolves late -> must immediately release mic tracks and NOT double-fire onEnd
      resolvePerm(delayedStream);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(stoppedLateTracks, 1, 'Late-resolved mic track must be stopped immediately');
      assert.equal(endCalls, 1, 'Late permission resolution must not double-fire onEnd');
      passed++;
      console.log('✓ Scenario 19 passed: Stop during pending getUserMedia finalizes cleanly & releases late tracks');
    }

    console.log(`\nALL ${passed}/19 VOICE INPUT & STT REPAIR SCENARIOS PASSED.`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

run().catch((err) => {
  console.error('VOICE INPUT TEST FAILURE:', err);
  process.exit(1);
});
