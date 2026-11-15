import type { VoiceLang, VoicePhase } from './types';
import {
  OrderedChunkTranscriptBuffer,
  computePcm16RmsAndPeak,
  downsampleFloat32ToInt16,
  encodeMonoPcm16ToWavBytes,
  mergeTranscriptWithOverlap,
  normalizeSttSegment,
} from './transcript-merger';

export interface SpeechSession {
  stop: () => void;
  abort?: () => void;
}

export type CaptureErrorCode =
  | 'mic_permission_denied'
  | 'mic_not_found'
  | 'mic_busy'
  | 'mic_unsupported'
  | 'mic_unavailable'
  | 'network_offline'
  | 'stt_timeout'
  | 'stt_rate_limited'
  | 'stt_api_unavailable'
  | 'recognition_unsupported';

export interface CaptureCallbacks {
  onResult: (transcript: string, isFinal: boolean) => void;
  onError: (err: string) => void;
  onEnd: () => void;
  onPhaseChange?: (phase: VoicePhase) => void;
  onStatusChange?: (status: 'recording' | 'finalizing' | 'idle') => void;
  hints?: string[];
  shouldStopSpeakingFirst?: () => void;
}

export interface CaptureMetrics {
  firstPartialMs?: number;
  chunksDispatched: number;
  chunksSucceeded: number;
  mode: 'pcm-wav+preview' | 'pcm-wav' | 'mediarecorder' | 'web-speech';
}

export interface AudioMimeSelection {
  mimeType: string;
  cleanMimeType: string;
  ext: 'webm' | 'mp4' | 'ogg';
}

export interface SpeechRecognitionLikeEvent {
  resultIndex?: number;
  results: ArrayLike<{
    isFinal?: boolean;
    0?: { transcript?: string; confidence?: number };
    length?: number;
  }>;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  onresult: ((ev: SpeechRecognitionLikeEvent) => void) | null;
  onerror: ((ev: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

export interface CaptureEnvDeps {
  getNavigator?: () => {
    onLine?: boolean;
    mediaDevices?: {
      getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    };
  };
  createAudioContext?: () => AudioContext | null;
  createMediaRecorder?: (
    stream: MediaStream,
    options?: MediaRecorderOptions
  ) => MediaRecorder;
  isMimeTypeSupported?: (mime: string) => boolean;
  createSpeechRecognition?: () => SpeechRecognitionLike | null;
  fetchFn?: typeof fetch;
  nowMs?: () => number;
}

const TARGET_SAMPLE_RATE = 16_000;
const FIRST_WINDOW_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 2.4);
const STEP_WINDOW_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 3.6);
const OVERLAP_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.8);
const MIN_TAIL_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.12); // 120ms guarantees fast tail words aren't lost
const MAX_CAPTURE_MS = 300_000; // 5 minutes ceiling (never cuts off 30-60s+ farmer speech)
const FLUSH_STOP_SETTLE_MS = 45; // Drain final WebAudio hardware buffer before stopping tracks
const SILENCE_RMS_SKIP = 0.0015;
const SILENCE_PEAK_SKIP = 0.006;

export function getBrowserSpeechLocale(lang: VoiceLang): string {
  if (lang === 'sd') return 'sd-PK';
  if (lang === 'en') return 'en-PK';
  return 'ur-PK';
}

/**
 * Classifies browser getUserMedia / MediaRecorder / Web Speech errors into
 * crisp actionable codes separate from Gemini STT API errors.
 */
export function classifyMicrophoneError(err: unknown): CaptureErrorCode {
  const name =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'name' in err
      ? String((err as { name?: unknown }).name || '')
      : '';
  const low = name.toLowerCase();

  if (
    low === 'notallowederror' ||
    low === 'permissiondeniederror' ||
    low === 'securityerror' ||
    low === 'not-allowed' ||
    low === 'service-not-allowed'
  ) {
    return 'mic_permission_denied';
  }
  if (low === 'notfounderror' || low === 'devicesnotfounderror' || low === 'audio-capture') {
    return 'mic_not_found';
  }
  if (low === 'notreadableerror' || low === 'trackstarterror') {
    return 'mic_busy';
  }
  if (low === 'notsupportederror') {
    return 'mic_unsupported';
  }
  return 'mic_unavailable';
}

/**
 * Capability-based MIME type selection across Chrome/Android (WebM/Opus),
 * Safari/iOS (MP4/AAC), Firefox (Ogg/Opus), and default container fallback.
 */
export function pickSupportedAudioMimeType(
  isSupported?: (mime: string) => boolean
): AudioMimeSelection {
  const check =
    isSupported ||
    (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? (m: string) => MediaRecorder.isTypeSupported(m)
      : null);

  if (check) {
    if (check('audio/webm;codecs=opus')) {
      return { mimeType: 'audio/webm;codecs=opus', cleanMimeType: 'audio/webm', ext: 'webm' };
    }
    if (check('audio/webm')) {
      return { mimeType: 'audio/webm', cleanMimeType: 'audio/webm', ext: 'webm' };
    }
    if (check('audio/mp4;codecs=mp4a.40.2')) {
      return { mimeType: 'audio/mp4;codecs=mp4a.40.2', cleanMimeType: 'audio/mp4', ext: 'mp4' };
    }
    if (check('audio/mp4')) {
      return { mimeType: 'audio/mp4', cleanMimeType: 'audio/mp4', ext: 'mp4' };
    }
    if (check('audio/ogg;codecs=opus')) {
      return { mimeType: 'audio/ogg;codecs=opus', cleanMimeType: 'audio/ogg', ext: 'ogg' };
    }
  }

  return { mimeType: '', cleanMimeType: 'audio/webm', ext: 'webm' };
}

/**
 * Combines authoritative committed server STT text with ONLY the uncommitted
 * tail of live browser preview words spoken after the latest committed window.
 */
export function composeDisplayTranscript(
  committedText: string,
  previewFullText: string,
  committedPreviewWordCount: number
): string {
  const cleanCommitted = normalizeSttSegment(committedText);
  const cleanPreview = normalizeSttSegment(previewFullText);

  if (!cleanCommitted) return cleanPreview;
  if (!cleanPreview) return cleanCommitted;

  const previewTokens = cleanPreview.split(' ');
  if (committedPreviewWordCount >= previewTokens.length) {
    return cleanCommitted;
  }

  const unseenTail = previewTokens.slice(Math.max(0, committedPreviewWordCount)).join(' ');
  return mergeTranscriptWithOverlap(cleanCommitted, unseenTail);
}

function getDefaultAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function getDefaultSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore track stop failures
      }
    });
  } catch {
    // ignore
  }
}

function concatInt16Chunks(chunks: Int16Array[], totalLength: number): Int16Array {
  const out = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Pure Web Speech recognition with pause tolerance, auto-restart across browser
 * idle closes, and zero forced cutoff — used offline or on browsers lacking WebAudio/MediaRecorder.
 */
export function startFixedBrowserSpeechRecognition(
  lang: VoiceLang,
  callbacks: CaptureCallbacks,
  deps: CaptureEnvDeps = {}
): SpeechSession | null {
  const createRec = deps.createSpeechRecognition || getDefaultSpeechRecognition;
  const rec = createRec();
  if (!rec) {
    callbacks.onPhaseChange?.('error');
    callbacks.onStatusChange?.('idle');
    callbacks.onError('recognition_unsupported');
    callbacks.onEnd();
    return null;
  }

  rec.lang = getBrowserSpeechLocale(lang);
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let userStopped = false;
  let aborted = false;
  let finished = false;
  let committedAcrossRestarts = '';
  let currentSessionFinal = '';
  let latestDisplay = '';
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = (emitFinal: boolean) => {
    if (finished) return;
    finished = true;
    if (safetyTimer) clearTimeout(safetyTimer);
    if (restartTimer) clearTimeout(restartTimer);
    if (emitFinal && !aborted && latestDisplay.trim()) {
      callbacks.onResult(latestDisplay.trim(), true);
    }
    callbacks.onPhaseChange?.('idle');
    callbacks.onStatusChange?.('idle');
    callbacks.onEnd();
  };

  safetyTimer = setTimeout(() => {
    userStopped = true;
    try {
      rec.stop();
    } catch {
      finish(true);
    }
  }, MAX_CAPTURE_MS);

  const wireRecognitionHandlers = (instance: SpeechRecognitionLike) => {
    instance.lang = getBrowserSpeechLocale(lang);
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onresult = (event) => {
      if (aborted || finished) return;
      let rebuiltFinal = '';
      let rebuiltInterim = '';
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const piece = res?.[0]?.transcript || '';
        if (!piece) continue;
        if (res.isFinal) {
          rebuiltFinal = mergeTranscriptWithOverlap(rebuiltFinal, piece);
        } else {
          rebuiltInterim = `${rebuiltInterim} ${piece}`.trim();
        }
      }
      currentSessionFinal = rebuiltFinal;
      const committedNow = mergeTranscriptWithOverlap(committedAcrossRestarts, currentSessionFinal);
      latestDisplay = normalizeSttSegment([committedNow, rebuiltInterim].filter(Boolean).join(' '));
      if (latestDisplay) {
        callbacks.onResult(latestDisplay, false);
      }
    };

    instance.onerror = (ev) => {
      if (aborted || finished) return;
      const errCode = (ev?.error || '').toLowerCase();
      // 'no-speech' and 'aborted' are transient on pauses / restart transitions
      if (errCode === 'no-speech') {
        return;
      }
      if (errCode === 'network') {
        userStopped = true;
        callbacks.onPhaseChange?.('error');
        callbacks.onError('network_offline');
        finish(Boolean(latestDisplay.trim()));
        return;
      }
      userStopped = true;
      callbacks.onPhaseChange?.('error');
      callbacks.onError(classifyMicrophoneError(errCode));
      finish(Boolean(latestDisplay.trim()));
    };

    instance.onend = () => {
      if (aborted || finished) return;
      if (currentSessionFinal) {
        committedAcrossRestarts = mergeTranscriptWithOverlap(
          committedAcrossRestarts,
          currentSessionFinal
        );
        currentSessionFinal = '';
      }
      if (userStopped) {
        finish(true);
        return;
      }
      // Browser Web Speech often closes after ~8-10s pause even with continuous=true; revive transparently
      restartTimer = setTimeout(() => {
        if (userStopped || aborted || finished) {
          finish(true);
          return;
        }
        try {
          instance.start();
        } catch {
          finish(true);
        }
      }, 120);
    };
  };

  wireRecognitionHandlers(rec);

  try {
    rec.start();
    callbacks.onStatusChange?.('recording');
    callbacks.onPhaseChange?.('listening');
  } catch (err) {
    callbacks.onPhaseChange?.('error');
    callbacks.onStatusChange?.('idle');
    callbacks.onError(classifyMicrophoneError(err));
    finish(false);
    return null;
  }

  return {
    stop: () => {
      if (userStopped || finished) return;
      userStopped = true;
      callbacks.onStatusChange?.('finalizing');
      callbacks.onPhaseChange?.('thinking');
      try {
        rec.stop();
      } catch {
        finish(true);
      }
    },
    abort: () => {
      aborted = true;
      userStopped = true;
      try {
        rec.abort?.();
        rec.stop();
      } catch {
        // ignore
      }
      finish(false);
    },
  };
}

/**
 * Primary production voice capture session:
 * - Captures microphone audio with echoCancellation + noiseSuppression + autoGainControl
 * - Encodes mono 16kHz PCM windows with 0.8s overlap as standalone headered audio/wav files
 * - Uploads increments sequentially + merges out-of-order responses via OrderedChunkTranscriptBuffer
 * - Runs a non-blocking Web Speech live-preview overlay (ur/en) for instant <300ms visual feedback
 * - Falls back cleanly to capability-detected MediaRecorder or fixed Web Speech when needed
 */
export function createFieldSpeechCapture(
  lang: VoiceLang,
  callbacks: CaptureCallbacks,
  deps: CaptureEnvDeps = {}
): SpeechSession | null {
  callbacks.shouldStopSpeakingFirst?.();

  const readNav = () =>
    deps.getNavigator?.() ??
    (typeof navigator !== 'undefined'
      ? { onLine: navigator.onLine, mediaDevices: navigator.mediaDevices }
      : { onLine: true, mediaDevices: undefined });

  const nav = readNav();

  const fetchFn =
    deps.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  const nowMs = deps.nowMs ?? (() => Date.now());

  if (nav.onLine === false) {
    return startFixedBrowserSpeechRecognition(lang, callbacks, deps);
  }

  if (!nav.mediaDevices?.getUserMedia || !fetchFn) {
    return startFixedBrowserSpeechRecognition(lang, callbacks, deps);
  }

  const getUserMedia = nav.mediaDevices.getUserMedia.bind(nav.mediaDevices);

  let aborted = false;
  let stopped = false;
  let finalized = false;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let processorNode: ScriptProcessorNode | null = null;
  let silentGainNode: GainNode | null = null;
  let fallbackRecorder: MediaRecorder | null = null;
  let previewRec: SpeechRecognitionLike | null = null;
  let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  let windowPumpInterval: ReturnType<typeof setInterval> | null = null;

  const buffer = new OrderedChunkTranscriptBuffer();
  const pcmChunks: Int16Array[] = [];
  let totalPcmSamples = 0;
  let lastEmittedEndSample = 0;
  let nextSeq = 0;
  let speechHasStarted = false;
  let inFlightCount = 0;
  let previewFullText = '';
  let previewCommittedWordCount = 0;
  let previewDisabled = false;
  let lastErrorEmitted: CaptureErrorCode | null = null;
  let uploadChain: Promise<void> = Promise.resolve();
  const activeFetchControllers = new Set<AbortController>();
  const pendingUploads: Array<Promise<void>> = [];

  callbacks.onPhaseChange?.('listening');
  callbacks.onStatusChange?.('recording');

  const emitDisplay = (isFinal = false) => {
    if (aborted) return;
    const { committedText } = buffer.getState();
    const displayText = isFinal
      ? normalizeSttSegment(committedText || previewFullText)
      : composeDisplayTranscript(committedText, previewFullText, previewCommittedWordCount);
    if (displayText) {
      callbacks.onResult(displayText, isFinal);
    }
  };

  const stopPreviewOverlay = () => {
    previewDisabled = true;
    if (!previewRec) return;
    const rec = previewRec;
    previewRec = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort?.();
      rec.stop();
    } catch {
      // ignore
    }
  };

  const cleanupAudioHardware = () => {
    if (maxDurationTimer) {
      clearTimeout(maxDurationTimer);
      maxDurationTimer = null;
    }
    if (windowPumpInterval) {
      clearInterval(windowPumpInterval);
      windowPumpInterval = null;
    }
    stopPreviewOverlay();
    if (processorNode) {
      try {
        processorNode.onaudioprocess = null;
        processorNode.disconnect();
      } catch {
        // ignore
      }
      processorNode = null;
    }
    if (silentGainNode) {
      try {
        silentGainNode.disconnect();
      } catch {
        // ignore
      }
      silentGainNode = null;
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {
        // ignore
      }
      sourceNode = null;
    }
    if (audioCtx) {
      try {
        if (audioCtx.state !== 'closed') {
          void audioCtx.close().catch(() => {});
        }
      } catch {
        // ignore
      }
      audioCtx = null;
    }
    stopMediaStream(stream);
    stream = null;
  };

  const startLivePreviewOverlay = () => {
    // Web Speech preview significantly boosts latency for Urdu and English;
    // Sindhi ('sd') lacks native Web Speech grammars on most browsers so we keep Gemini authoritative.
    if (lang === 'sd' || previewDisabled || stopped || aborted) return;

    const createRec = deps.createSpeechRecognition || getDefaultSpeechRecognition;
    const rec = createRec();
    if (!rec) return;

    let overlayBaseFinal = '';
    let overlayCurrentFinal = '';

    const setup = (instance: SpeechRecognitionLike) => {
      instance.lang = getBrowserSpeechLocale(lang);
      instance.continuous = true;
      instance.interimResults = true;
      instance.maxAlternatives = 1;

      instance.onresult = (ev) => {
        if (stopped || aborted || previewDisabled) return;
        let sessionFinal = '';
        let interim = '';
        for (let i = 0; i < ev.results.length; i++) {
          const item = ev.results[i];
          const text = item?.[0]?.transcript || '';
          if (!text) continue;
          if (item.isFinal) {
            sessionFinal = mergeTranscriptWithOverlap(sessionFinal, text);
          } else {
            interim = `${interim} ${text}`.trim();
          }
        }
        overlayCurrentFinal = sessionFinal;
        const fullFinal = mergeTranscriptWithOverlap(overlayBaseFinal, sessionFinal);
        previewFullText = normalizeSttSegment([fullFinal, interim].filter(Boolean).join(' '));
        emitDisplay(false);
      };

      instance.onerror = () => {
        // Silently degrade live overlay on Android dual-mic contention or cloud error
        // so primary PCM -> Gemini WAV recording is NEVER interrupted.
        stopPreviewOverlay();
      };

      instance.onend = () => {
        if (stopped || aborted || previewDisabled) return;
        if (overlayCurrentFinal) {
          overlayBaseFinal = mergeTranscriptWithOverlap(overlayBaseFinal, overlayCurrentFinal);
          overlayCurrentFinal = '';
        }
        try {
          instance.start();
        } catch {
          stopPreviewOverlay();
        }
      };
    };

    setup(rec);
    previewRec = rec;
    try {
      rec.start();
    } catch {
      stopPreviewOverlay();
    }
  };

  const uploadAudioWindow = async (
    seq: number,
    bytes: Uint8Array,
    cleanMime: string,
    ext: string,
    previewWordWatermark: number
  ): Promise<void> => {
    if (aborted) return;

    const form = new FormData();
    const copyBuf = new Uint8Array(bytes.byteLength);
    copyBuf.set(bytes);
    const blob = new Blob([copyBuf.buffer], { type: cleanMime });
    form.append('audio', blob, `chunk-${seq}.${ext}`);
    form.append('lang', lang);
    if (callbacks.hints?.length) {
      form.append('hints', callbacks.hints.join(','));
    }
    const priorContext = buffer.getTailContext(12);
    if (priorContext) {
      form.append('previousContext', priorContext);
    }

    const controller = new AbortController();
    activeFetchControllers.add(controller);
    const abortTimeout = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, 28_000);

    try {
      inFlightCount++;
      const res = await fetchFn('/api/stt', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });

      if (aborted) return;

      if (!res.ok) {
        const errPayload = (await res.json().catch(() => ({}))) as { error?: string };
        const code: CaptureErrorCode =
          errPayload.error === 'stt_timeout' || res.status === 504
            ? 'stt_timeout'
            : errPayload.error === 'service_busy' || res.status === 429
            ? 'stt_rate_limited'
            : 'stt_api_unavailable';
        lastErrorEmitted = code;
        buffer.acceptChunk(seq, '');
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { transcript?: string };
      const text = normalizeSttSegment(data.transcript || '');
      buffer.acceptChunk(seq, text);
      if (text && previewWordWatermark > previewCommittedWordCount) {
        previewCommittedWordCount = previewWordWatermark;
      }
      if (!stopped) {
        emitDisplay(false);
      }
    } catch (err) {
      if (aborted) return;
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const isOffline = readNav().onLine === false || err instanceof TypeError;
      lastErrorEmitted = isOffline
        ? 'network_offline'
        : isTimeout
        ? 'stt_timeout'
        : 'stt_api_unavailable';
      buffer.acceptChunk(seq, '');
    } finally {
      clearTimeout(abortTimeout);
      activeFetchControllers.delete(controller);
      inFlightCount--;
    }
  };

  const enqueueWindowUpload = (
    bytes: Uint8Array,
    cleanMime: string,
    ext: string
  ): void => {
    if (aborted) return;
    const seq = nextSeq++;
    const watermark = previewFullText ? previewFullText.split(' ').length : 0;

    // Chain dispatch order lightly so chunks reach Gemini mostly in sequence with prior context,
    // while never dropping a chunk if an earlier request stalls.
    const task = uploadChain
      .catch(() => {})
      .then(() => uploadAudioWindow(seq, bytes, cleanMime, ext, watermark));
    uploadChain = task.catch(() => {});
    pendingUploads.push(task);
  };

  const slicePcmWindow = (startSample: number, endSample: number): Int16Array => {
    const all = concatInt16Chunks(pcmChunks, totalPcmSamples);
    return all.subarray(Math.max(0, startSample), Math.min(all.length, endSample));
  };

  const flushPcmWindow = (isFinalFlush: boolean): void => {
    const newSamplesCount = totalPcmSamples - lastEmittedEndSample;
    if (newSamplesCount <= 0) return;
    if (isFinalFlush && newSamplesCount < MIN_TAIL_SAMPLES && lastEmittedEndSample > 0) {
      return;
    }
    if (isFinalFlush && lastEmittedEndSample === 0 && newSamplesCount < MIN_TAIL_SAMPLES) {
      return;
    }

    const freshSlice = slicePcmWindow(lastEmittedEndSample, totalPcmSamples);
    const { rms, peak } = computePcm16RmsAndPeak(freshSlice);
    const hasAudibleSignal = peak >= SILENCE_PEAK_SKIP || rms >= SILENCE_RMS_SKIP;

    const overlapStart = Math.max(0, lastEmittedEndSample - OVERLAP_SAMPLES);
    const endSample = totalPcmSamples;
    lastEmittedEndSample = endSample;

    if (!hasAudibleSignal) {
      return;
    }

    speechHasStarted = true;
    const windowPcm = slicePcmWindow(overlapStart, endSample);
    const wavBytes = encodeMonoPcm16ToWavBytes(windowPcm, TARGET_SAMPLE_RATE);
    enqueueWindowUpload(wavBytes, 'audio/wav', 'wav');
  };

  const maybeScheduleWindow = () => {
    if (stopped || aborted) return;
    const unemitted = totalPcmSamples - lastEmittedEndSample;
    const threshold =
      lastEmittedEndSample === 0 && !speechHasStarted
        ? FIRST_WINDOW_SAMPLES
        : STEP_WINDOW_SAMPLES;

    if (unemitted >= threshold && inFlightCount < 2) {
      flushPcmWindow(false);
    }
  };

  const finishCapture = async (emitTailFlush: boolean) => {
    if (finalized) return;
    finalized = true;

    if (aborted) {
      cleanupAudioHardware();
      callbacks.onPhaseChange?.('idle');
      callbacks.onStatusChange?.('idle');
      callbacks.onEnd();
      return;
    }

    callbacks.onStatusChange?.('finalizing');
    callbacks.onPhaseChange?.('thinking');

    if (emitTailFlush) {
      // Allow trailing hardware frame to drain before closing AudioContext
      await new Promise((r) => setTimeout(r, FLUSH_STOP_SETTLE_MS));
      if (!aborted && fallbackRecorder && fallbackRecorder.state === 'recording') {
        await new Promise<void>((resolve) => {
          const rec = fallbackRecorder!;
          const oldStop = rec.onstop;
          rec.onstop = async (ev) => {
            try {
              await (oldStop?.call(rec, ev) as unknown as Promise<void> | void);
            } finally {
              resolve();
            }
          };
          try {
            if (typeof rec.requestData === 'function') {
              rec.requestData();
            }
            rec.stop();
          } catch {
            resolve();
          }
        });
      } else if (!aborted && audioCtx) {
        flushPcmWindow(true);
      }
    }

    cleanupAudioHardware();

    if (!aborted && pendingUploads.length > 0) {
      await Promise.allSettled(pendingUploads);
    }

    if (aborted) {
      callbacks.onPhaseChange?.('idle');
      callbacks.onStatusChange?.('idle');
      callbacks.onEnd();
      return;
    }

    const committed = buffer.getState().committedText;
    const fallbackPreview = normalizeSttSegment(previewFullText);
    const finalTranscript = committed || fallbackPreview;

    if (finalTranscript) {
      callbacks.onResult(finalTranscript, true);
      callbacks.onPhaseChange?.('idle');
      if (lastErrorEmitted && !committed && fallbackPreview) {
        // Rescued partial offline/API failure using preview — still report API error non-destructively
        callbacks.onError(lastErrorEmitted);
      }
    } else if (lastErrorEmitted) {
      callbacks.onPhaseChange?.('error');
      callbacks.onError(lastErrorEmitted);
    } else {
      callbacks.onPhaseChange?.('idle');
    }

    callbacks.onStatusChange?.('idle');
    callbacks.onEnd();
  };

  const startMediaRecorderFallback = (micStream: MediaStream): boolean => {
    const selection = pickSupportedAudioMimeType(deps.isMimeTypeSupported);
    const createRec =
      deps.createMediaRecorder ||
      (typeof MediaRecorder !== 'undefined'
        ? (s: MediaStream, opts?: MediaRecorderOptions) =>
            opts ? new MediaRecorder(s, opts) : new MediaRecorder(s)
        : null);
    if (!createRec) return false;

    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = selection.mimeType
        ? createRec(micStream, { mimeType: selection.mimeType })
        : createRec(micStream);
    } catch {
      try {
        rec = createRec(micStream);
      } catch {
        return false;
      }
    }

    fallbackRecorder = rec;
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };
    rec.onstop = async () => {
      if (aborted || chunks.length === 0) return;
      const blob = new Blob(chunks, {
        type: selection.cleanMimeType || chunks[0]?.type || 'audio/webm',
      });
      if (blob.size < 120) return;
      const ab = await blob.arrayBuffer();
      enqueueWindowUpload(new Uint8Array(ab), selection.cleanMimeType, selection.ext);
    };

    try {
      rec.start(1000);
      return true;
    } catch {
      try {
        rec.start();
        return true;
      } catch {
        return false;
      }
    }
  };

  // Async microphone permission & dual-track capture boot
  void (async () => {
    try {
      const micStream = await getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      if (aborted || stopped) {
        stopMediaStream(micStream);
        return;
      }

      stream = micStream;
      startLivePreviewOverlay();

      const ctx = deps.createAudioContext ? deps.createAudioContext() : getDefaultAudioContext();
      if (ctx && typeof ctx.createMediaStreamSource === 'function' && typeof ctx.createScriptProcessor === 'function') {
        audioCtx = ctx;
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          await ctx.resume().catch(() => {});
        }
        sourceNode = ctx.createMediaStreamSource(micStream);
        processorNode = ctx.createScriptProcessor(4096, 1, 1);
        silentGainNode = ctx.createGain();
        silentGainNode.gain.value = 0;

        const inputSampleRate = ctx.sampleRate || 48_000;
        processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
          if (aborted || stopped) return;
          const channel = event.inputBuffer.getChannelData(0);
          if (!channel || channel.length === 0) return;
          const pcm16 = downsampleFloat32ToInt16(channel, inputSampleRate, TARGET_SAMPLE_RATE);
          pcmChunks.push(pcm16);
          totalPcmSamples += pcm16.length;
          maybeScheduleWindow();
        };

        sourceNode.connect(processorNode);
        processorNode.connect(silentGainNode);
        silentGainNode.connect(ctx.destination);

        // Periodic window check guarantees tail/active speech flush even if processor cadence varies
        windowPumpInterval = setInterval(() => {
          if (stopped || aborted) return;
          if (nowMs() - sessionStartedAt >= MAX_CAPTURE_MS) {
            stopped = true;
            void finishCapture(true);
            return;
          }
          maybeScheduleWindow();
        }, 650);
      } else if (!startMediaRecorderFallback(micStream)) {
        cleanupAudioHardware();
        callbacks.onPhaseChange?.('error');
        callbacks.onStatusChange?.('idle');
        callbacks.onError('mic_unsupported');
        callbacks.onEnd();
        return;
      }

      maxDurationTimer = setTimeout(() => {
        if (stopped || aborted) return;
        stopped = true;
        void finishCapture(true);
      }, MAX_CAPTURE_MS);
    } catch (err) {
      cleanupAudioHardware();
      if (aborted) return;
      callbacks.onPhaseChange?.('error');
      callbacks.onStatusChange?.('idle');
      callbacks.onError(classifyMicrophoneError(err));
      callbacks.onEnd();
    }
  })();

  const sessionStartedAt = nowMs();

  return {
    stop: () => {
      if (stopped || aborted) return;
      stopped = true;
      void finishCapture(true);
    },
    abort: () => {
      if (aborted) return;
      aborted = true;
      stopped = true;
      activeFetchControllers.forEach((ctrl) => {
        try {
          ctrl.abort();
        } catch {
          // ignore
        }
      });
      void finishCapture(false);
    },
  };
}
