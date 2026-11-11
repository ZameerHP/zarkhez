/**
 * Unified Neural Voice & Field Speech Recognition Client Engine (lib/voice.ts)
 * - Uses provider-agnostic /api/tts neural audio (Gemini TTS / ElevenLabs v3 / Azure ur-PK / MMS Sindhi)
 * - Strictly isolates Urdu (ur-PK), Sindhi (sd-PK Arabic script), and English (en-PK)
 * - Never uses Google Translate TTS or sends Sindhi text to Urdu/Hindi browser voices
 * - Browser speechSynthesis is strictly retained ONLY as last-resort offline fallback
 * - Supports background preload, Pause/Resume, Slow Repeat (0.75x), word highlighting,
 *   noise-suppressed push-to-talk + ~900ms VAD end-of-speech STT, and barge-in.
 */

import { toSpokenText } from './voice/spoken-normalizer';
import {
  cleanTechnicalMetadataForSpeech,
  looksLikeRomanUrdu,
  splitSpeechIntoChunks,
  transliterateCommonRomanUrduToUrdu,
} from './voice/speech-prep';
import type {
  VoiceGender,
  VoiceLang,
  VoicePhase,
  VoiceSpeedMode,
} from './voice/types';

export type { VoiceGender, VoiceLang, VoicePhase, VoiceSpeedMode };

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionInstanceLike;

export interface VoiceAudioMeta {
  audioId: string;
  provider: string;
  locale: string;
  cacheStatus: string;
  spokenText: string;
}

export interface SpeakCallbacks {
  gender?: VoiceGender;
  speedMode?: VoiceSpeedMode;
  clipId?: string;
  onStart?: (hasNativeVoice: boolean) => void;
  onEnd?: () => void;
  onError?: () => void;
  onPauseChange?: (paused: boolean) => void;
  onPhaseChange?: (phase: VoicePhase) => void;
  onWordHighlight?: (wordIndex: number, words: string[], spokenText: string) => void;
  onMeta?: (meta: VoiceAudioMeta) => void;
}

const PRELOAD_CACHE_MAX = 40;
const VOICE_PERSISTENT_CACHE_NAME = 'zarkhez-tts-v1';
const preloadedBlobs = new Map<
  string,
  { blob: Blob; meta: VoiceAudioMeta }
>();

async function readPersistentAudioCache(
  key: string
): Promise<{ blob: Blob; meta: VoiceAudioMeta } | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cache = await caches.open(VOICE_PERSISTENT_CACHE_NAME);
    const cacheUrl = `/__voice_cache__/${encodeURIComponent(key)}`;
    const matched = await cache.match(cacheUrl);
    if (!matched) return null;
    const blob = await matched.blob();
    if (!blob || blob.size < 128) return null;
    const metaHeader = matched.headers.get('X-Voice-Meta');
    const parsedMeta: VoiceAudioMeta = metaHeader
      ? JSON.parse(decodeURIComponent(metaHeader))
      : { audioId: key, provider: 'cache', locale: 'ur-PK', cacheStatus: 'hit', spokenText: '' };
    return { blob, meta: { ...parsedMeta, cacheStatus: 'hit' } };
  } catch {
    return null;
  }
}

async function writePersistentAudioCache(
  key: string,
  entry: { blob: Blob; meta: VoiceAudioMeta }
): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await caches.open(VOICE_PERSISTENT_CACHE_NAME);
    const cacheUrl = `/__voice_cache__/${encodeURIComponent(key)}`;
    const resp = new Response(entry.blob, {
      headers: {
        'Content-Type': entry.blob.type || 'audio/wav',
        'X-Voice-Meta': encodeURIComponent(JSON.stringify(entry.meta)),
      },
    });
    await cache.put(cacheUrl, resp);
  } catch {
    // ignore storage quota errors cleanly
  }
}

let sharedAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let audioUnlocked = false;
let currentVoiceSession = 0;
let activeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let activeWordTimer: ReturnType<typeof setInterval> | null = null;
let lastPlaybackArgs: {
  text: string;
  lang: VoiceLang;
  callbacks?: SpeakCallbacks;
} | null = null;
const activeAbortControllers = new Set<AbortController>();

function clearTimers(): void {
  if (activeFallbackTimer) {
    clearTimeout(activeFallbackTimer);
    activeFallbackTimer = null;
  }
  if (activeWordTimer) {
    clearInterval(activeWordTimer);
    activeWordTimer = null;
  }
}

function revokeActiveUrl(): void {
  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl);
    } catch {
      // ignore
    }
    activeObjectUrl = null;
  }
}

function getSharedAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

export function normalizeVoiceLang(lang: string | undefined | null): VoiceLang {
  const low = (lang || '').toLowerCase();
  if (low.startsWith('sd') || low.includes('sindhi')) return 'sd';
  if (low.startsWith('en') || low.includes('english')) return 'en';
  return 'ur';
}

export function getSavedVoiceGender(_lang: VoiceLang): VoiceGender {
  return 'female';
}

export function setSavedVoiceGender(_lang: VoiceLang, _gender: VoiceGender): void {
  // Locked to one uniform mature Female voice across the app
}

export function getSavedVoiceSpeed(): VoiceSpeedMode {
  if (typeof window === 'undefined') return 'normal';
  try {
    const val = localStorage.getItem('zarkhez_voice_speed_mode');
    if (val === 'slow' || val === 'normal') return val;
  } catch {
    // ignore
  }
  return 'normal';
}

export function setSavedVoiceSpeed(mode: VoiceSpeedMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('zarkhez_voice_speed_mode', mode);
  } catch {
    // ignore
  }
}

export function unlockAudio(): void {
  if (typeof window === 'undefined' || audioUnlocked) return;
  audioUnlocked = true;
  try {
    const dummy = new Audio();
    dummy.src =
      'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    dummy.volume = 0.01;
    dummy.play().catch(() => {});
  } catch {
    // ignore
  }
}

export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_~`>|[\]()•]/g, ' ')
    .replace(/\bRs\.\s*/gi, 'روپے ')
    .replace(/\bPKR\b/gi, 'روپے')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildClientPreloadKey(
  spokenText: string,
  lang: VoiceLang,
  gender: VoiceGender,
  speedMode: VoiceSpeedMode
): string {
  return `${lang}:${gender}:${speedMode}:${spokenText}`;
}

async function fetchTtsBlob(params: {
  text: string;
  lang: VoiceLang;
  gender: VoiceGender;
  speedMode: VoiceSpeedMode;
  clipId?: string;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; meta: VoiceAudioMeta } | null> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: params.text,
      lang: params.lang,
      gender: params.gender,
      speedMode: params.speedMode,
      speed: params.speedMode === 'slow' ? 0.82 : 1.0,
      clipId: params.clipId,
    }),
    signal: params.signal,
  });

  if (!res.ok) {
    return null;
  }

  const blob = await res.blob();
  if (!blob || blob.size < 128) return null;

  const decodedSpoken = res.headers.get('X-Spoken-Text')
    ? decodeURIComponent(res.headers.get('X-Spoken-Text')!)
    : params.text;

  const meta: VoiceAudioMeta = {
    audioId: res.headers.get('X-Audio-Id') || `zrk-${Date.now()}`,
    provider: res.headers.get('X-Voice-Provider') || 'neural',
    locale: res.headers.get('X-Voice-Locale') || (params.lang === 'sd' ? 'sd-PK' : params.lang === 'ur' ? 'ur-PK' : 'en-PK'),
    cacheStatus: res.headers.get('X-Voice-Cache') || 'miss',
    spokenText: decodedSpoken,
  };

  return { blob, meta };
}

/**
 * Preloads spoken audio quietly in the background (e.g. for WeatherCard)
 * so tapping "Listen in Voice" starts immediately (<100ms).
 */
export async function preloadSpeechAudio(
  text: string,
  rawLang: string = 'ur',
  genderOverride?: VoiceGender,
  speedOverride?: VoiceSpeedMode
): Promise<void> {
  if (typeof window === 'undefined' || navigator.onLine === false || !text.trim()) return;
  const lang = normalizeVoiceLang(rawLang);
  const gender = genderOverride || getSavedVoiceGender(lang);
  const speedMode = speedOverride || getSavedVoiceSpeed();
  const normalized = toSpokenText(text, lang);
  if (!normalized.spokenText) return;

  const key = buildClientPreloadKey(normalized.spokenText, lang, gender, speedMode);
  if (preloadedBlobs.has(key)) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const result = await fetchTtsBlob({
      text: normalized.spokenText,
      lang,
      gender,
      speedMode,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (result) {
      if (preloadedBlobs.size >= PRELOAD_CACHE_MAX) {
        const firstKey = preloadedBlobs.keys().next().value;
        if (firstKey) preloadedBlobs.delete(firstKey);
      }
      preloadedBlobs.set(key, result);
      void writePersistentAudioCache(key, result);
    }
  } catch {
    // background preload fails quietly without disturbing user
  }
}

/**
 * Last-resort offline browser synthesis ONLY when offline or all neural servers fail.
 * Strictly NEVER routes Sindhi (sd) to an Urdu or Hindi browser voice.
 */
function speakWithOfflineFallback(
  spokenText: string,
  lang: VoiceLang,
  sessionId: number,
  speedMode: VoiceSpeedMode,
  callbacks?: SpeakCallbacks
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    callbacks?.onPhaseChange?.('error');
    callbacks?.onError?.();
    return;
  }
  if (sessionId !== currentVoiceSession) return;

  try {
    const voices = window.speechSynthesis.getVoices();
    if (lang === 'sd') {
      const sindhiVoice = voices.find((v) =>
        v.lang.toLowerCase().replace('_', '-').startsWith('sd')
      );
      if (!sindhiVoice) {
        // Strictly refuse sending Sindhi text to Urdu/Hindi/Arabic browser voices
        callbacks?.onPhaseChange?.('error');
        callbacks?.onError?.();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(spokenText);
      u.voice = sindhiVoice;
      u.lang = sindhiVoice.lang;
      u.rate = speedMode === 'slow' ? 0.75 : 0.9;
      u.onstart = () => {
        if (sessionId !== currentVoiceSession) return;
        callbacks?.onPhaseChange?.('speaking');
        callbacks?.onStart?.(false);
      };
      u.onend = () => {
        if (sessionId === currentVoiceSession) {
          callbacks?.onPhaseChange?.('idle');
          callbacks?.onEnd?.();
        }
      };
      u.onerror = () => {
        if (sessionId === currentVoiceSession) {
          callbacks?.onPhaseChange?.('error');
          callbacks?.onError?.();
        }
      };
      window.speechSynthesis.speak(u);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    if (lang === 'ur') {
      const urduVoice =
        voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ur-pk')) ||
        voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ur')) ||
        null;
      if (!urduVoice) {
        // NEVER push Urdu Unicode script into a non-Urdu English OS voice (causes unintelligible gibberish)
        callbacks?.onPhaseChange?.('error');
        callbacks?.onError?.();
        return;
      }
      utterance.voice = urduVoice;
      utterance.lang = urduVoice.lang;
    } else {
      const enVoice =
        voices.find((v) => v.lang.toLowerCase().startsWith('en') && v.name.includes('Natural')) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
        null;
      if (enVoice) utterance.voice = enVoice;
      utterance.lang = 'en-US';
    }

    utterance.rate = speedMode === 'slow' ? 0.75 : 0.9;
    utterance.onstart = () => {
      if (sessionId !== currentVoiceSession) {
        try { window.speechSynthesis.cancel(); } catch {}
        return;
      }
      callbacks?.onPhaseChange?.('speaking');
      callbacks?.onStart?.(false);
    };
    utterance.onend = () => {
      if (sessionId === currentVoiceSession) {
        callbacks?.onPhaseChange?.('idle');
        callbacks?.onEnd?.();
      }
    };
    utterance.onerror = () => {
      if (sessionId === currentVoiceSession) {
        callbacks?.onPhaseChange?.('error');
        callbacks?.onError?.();
      }
    };
    window.speechSynthesis.speak(utterance);
  } catch {
    callbacks?.onPhaseChange?.('error');
    callbacks?.onError?.();
  }
}

export function pauseSpeaking(): void {
  if (typeof window === 'undefined') return;
  if (sharedAudio && !sharedAudio.paused && sharedAudio.src) {
    try {
      sharedAudio.pause();
      lastPlaybackArgs?.callbacks?.onPauseChange?.(true);
    } catch {
      // ignore
    }
  } else if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    try {
      window.speechSynthesis.pause();
      lastPlaybackArgs?.callbacks?.onPauseChange?.(true);
    } catch {
      // ignore
    }
  }
}

export function resumeSpeaking(): void {
  if (typeof window === 'undefined') return;
  if (sharedAudio && sharedAudio.paused && sharedAudio.src) {
    sharedAudio.play().then(() => {
      lastPlaybackArgs?.callbacks?.onPauseChange?.(false);
    }).catch(() => {});
  } else if ('speechSynthesis' in window && window.speechSynthesis.paused) {
    try {
      window.speechSynthesis.resume();
      lastPlaybackArgs?.callbacks?.onPauseChange?.(false);
    } catch {
      // ignore
    }
  }
}

export function repeatLastSlowly(): void {
  if (!lastPlaybackArgs) return;
  const { text, lang, callbacks } = lastPlaybackArgs;
  speakText(text, lang, { ...callbacks, speedMode: 'slow' });
}

export function replayLast(): void {
  if (!lastPlaybackArgs) return;
  const { text, lang, callbacks } = lastPlaybackArgs;
  speakText(text, lang, callbacks);
}

export async function speakText(
  text: string,
  rawLang: VoiceLang | string,
  callbacks?: SpeakCallbacks
): Promise<void> {
  if (typeof window === 'undefined') return;

  stopSpeaking();
  const sessionId = currentVoiceSession;
  const lang = normalizeVoiceLang(rawLang);
  const gender: VoiceGender = 'female';
  const speedMode = callbacks?.speedMode || getSavedVoiceSpeed();

  lastPlaybackArgs = { text, lang, callbacks };

  const cleanedRaw = cleanTechnicalMetadataForSpeech(text);
  const scriptAligned =
    lang === 'ur' && looksLikeRomanUrdu(cleanedRaw)
      ? transliterateCommonRomanUrduToUrdu(cleanedRaw)
      : cleanedRaw;
  const normalized = toSpokenText(scriptAligned, lang);
  if (!normalized.spokenText) {
    callbacks?.onPhaseChange?.('idle');
    callbacks?.onEnd?.();
    return;
  }

  const spokenText = normalized.spokenText;
  const words = normalized.words;

  const hasAudioPlayback =
    typeof Audio !== 'undefined' ||
    typeof (window as unknown as { Audio?: unknown }).Audio !== 'undefined';

  if (!hasAudioPlayback || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    speakWithOfflineFallback(spokenText, lang, sessionId, speedMode, callbacks);
    return;
  }

  callbacks?.onPhaseChange?.('thinking');

  const resolveChunkAudio = async (
    chunkText: string,
    clipId?: string
  ): Promise<{ blob: Blob; meta: VoiceAudioMeta } | null> => {
    const key = buildClientPreloadKey(chunkText, lang, gender, speedMode);
    const memHit = preloadedBlobs.get(key);
    if (memHit) return memHit;

    const persistentHit = await readPersistentAudioCache(key);
    if (persistentHit) {
      preloadedBlobs.set(key, persistentHit);
      return persistentHit;
    }

    const controller = new AbortController();
    activeAbortControllers.add(controller);
    const fetchTimer = setTimeout(() => controller.abort(), 24000);

    try {
      const fetched = await fetchTtsBlob({
        text: chunkText,
        lang,
        gender,
        speedMode,
        clipId,
        signal: controller.signal,
      });
      if (!fetched) return null;
      if (preloadedBlobs.size >= PRELOAD_CACHE_MAX) {
        const firstKey = preloadedBlobs.keys().next().value;
        if (firstKey) preloadedBlobs.delete(firstKey);
      }
      preloadedBlobs.set(key, fetched);
      void writePersistentAudioCache(key, fetched);
      return fetched;
    } catch {
      return null;
    } finally {
      clearTimeout(fetchTimer);
      activeAbortControllers.delete(controller);
    }
  };

  const playChunkBlob = async (
    blob: Blob,
    meta: VoiceAudioMeta,
    isFirstChunk: boolean,
    chunkWordOffset: number,
    chunkWordCount: number
  ): Promise<boolean> => {
    if (sessionId !== currentVoiceSession) return true;
    const audio = getSharedAudio() || new Audio();
    revokeActiveUrl();
    const objUrl = URL.createObjectURL(blob);
    activeObjectUrl = objUrl;
    audio.volume = 1;
    // Azure Neural & ElevenLabs synthesize natively at natural target speed; avoid double-slowing audio.
    const needsClientSlowdown = meta.provider === 'gemini-tts' && speedMode === 'slow';
    audio.playbackRate = needsClientSlowdown ? 0.88 : 1.0;
    try {
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    } catch {
      // ignore on older browsers
    }

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const done = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimers();
        resolve(ok);
      };

      audio.onplay = () => {
        if (sessionId !== currentVoiceSession) {
          try {
            audio.pause();
            audio.src = '';
          } catch {}
          done(true);
          return;
        }
        clearTimers();
        if ('speechSynthesis' in window) {
          try { window.speechSynthesis.cancel(); } catch {}
        }
        callbacks?.onMeta?.(meta);
        callbacks?.onPhaseChange?.('speaking');
        callbacks?.onPauseChange?.(false);
        if (isFirstChunk) {
          callbacks?.onStart?.(true);
        }

        if (chunkWordCount > 0 && words.length > 0) {
          const updateHighlight = () => {
            if (!audio || audio.paused || sessionId !== currentVoiceSession) return;
            const dur =
              Number.isFinite(audio.duration) && audio.duration > 0
                ? audio.duration
                : Math.max(2, chunkWordCount * 0.38);
            const ratio = Math.min(0.999, Math.max(0, audio.currentTime / dur));
            const localIdx = Math.floor(ratio * chunkWordCount);
            const globalIdx = Math.min(words.length - 1, chunkWordOffset + localIdx);
            callbacks?.onWordHighlight?.(globalIdx, words, spokenText);
          };
          updateHighlight();
          activeWordTimer = setInterval(updateHighlight, 110);
        }
      };

      audio.onpause = () => {
        if (sessionId === currentVoiceSession && !audio.ended) {
          callbacks?.onPauseChange?.(true);
        }
      };

      audio.onended = () => done(true);
      audio.onerror = () => done(false);

      audio.src = objUrl;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => done(false));
      }
    });
  };

  try {
    // Split long explanations strictly along natural sentence boundaries; never truncate or pause awkwardly mid-thought.
    const chunks = splitSpeechIntoChunks(spokenText, lang, 620);
    if (chunks.length === 0) {
      callbacks?.onPhaseChange?.('idle');
      callbacks?.onEnd?.();
      return;
    }

    let nextChunkPromise: Promise<{ blob: Blob; meta: VoiceAudioMeta } | null> = resolveChunkAudio(
      chunks[0],
      chunks.length === 1 ? callbacks?.clipId : undefined
    );

    let wordOffset = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (sessionId !== currentVoiceSession) return;

      const chunkResult = await nextChunkPromise;
      if (sessionId !== currentVoiceSession) return;

      if (!chunkResult) {
        const remainingText = chunks.slice(i).join(' ');
        speakWithOfflineFallback(remainingText, lang, sessionId, speedMode, callbacks);
        return;
      }

      // Immediately prefetch next sentence chunk in background while current chunk plays seamlessly
      if (i + 1 < chunks.length) {
        nextChunkPromise = resolveChunkAudio(chunks[i + 1]);
      }

      const chunkWords = chunks[i]
        .replace(/[۔.!?؟،,؛;:]/g, '')
        .split(/\s+/)
        .filter(Boolean).length;

      const playedOk = await playChunkBlob(
        chunkResult.blob,
        { ...chunkResult.meta, spokenText },
        i === 0,
        wordOffset,
        chunkWords
      );

      if (sessionId !== currentVoiceSession) return;
      if (!playedOk) {
        const remainingText = chunks.slice(i).join(' ');
        speakWithOfflineFallback(remainingText, lang, sessionId, speedMode, callbacks);
        return;
      }
      wordOffset += chunkWords;
    }

    if (sessionId === currentVoiceSession) {
      callbacks?.onWordHighlight?.(-1, words, spokenText);
      callbacks?.onPhaseChange?.('idle');
      callbacks?.onEnd?.();
    }
  } catch {
    if (sessionId === currentVoiceSession) {
      speakWithOfflineFallback(spokenText, lang, sessionId, speedMode, callbacks);
    }
  }
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined') return;
  currentVoiceSession++;
  clearTimers();
  activeAbortControllers.forEach((controller) => {
    try { controller.abort(); } catch {}
  });
  activeAbortControllers.clear();
  revokeActiveUrl();

  if (sharedAudio) {
    try {
      sharedAudio.onplay = null;
      sharedAudio.onpause = null;
      sharedAudio.onended = null;
      sharedAudio.onerror = null;
      sharedAudio.pause();
      sharedAudio.src = '';
    } catch {
      // ignore
    }
  }

  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export async function submitPronunciationReport(payload: {
  word: string;
  lang: VoiceLang;
  audioId?: string;
  phrase?: string;
  expectedPronunciation?: string;
  note?: string;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/voice/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  const hasRecorder =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';
  return Boolean(hasRecorder || w.SpeechRecognition || w.webkitSpeechRecognition);
}

export interface SpeechSession {
  stop: () => void;
}

/**
 * Field-tuned speech recognition with:
 * - Barge-in cancellation of any ongoing TTS audio immediately
 * - Noise suppression + echo cancellation + auto gain control
 * - Real ~900ms Voice-Activity Detection (VAD) silence cutoff after speech
 * - Server /api/stt transcription (Gemini / Whisper / AssemblyAI with farming keyterms)
 * - Automatic browser Web Speech API fallback when offline or MediaRecorder unavailable
 */
export function startFieldSpeechCapture(
  rawLang: VoiceLang | string,
  callbacks: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError: (err: string) => void;
    onEnd: () => void;
    onPhaseChange?: (phase: VoicePhase) => void;
    hints?: string[];
  }
): SpeechSession | null {
  if (typeof window === 'undefined') return null;

  // Barge-in: immediately interrupt active voice output when user presses mic
  stopSpeaking();
  callbacks.onPhaseChange?.('listening');

  const lang = normalizeVoiceLang(rawLang);
  const canRecord =
    navigator.onLine !== false &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';

  if (!canRecord) {
    return startBrowserSpeechRecognition(lang, callbacks);
  }

  let stopped = false;
  let mediaRecorder: MediaRecorder | null = null;
  let streamRef: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let vadInterval: ReturnType<typeof setInterval> | null = null;
  const chunks: Blob[] = [];

  const cleanupMedia = () => {
    if (vadInterval) {
      clearInterval(vadInterval);
      vadInterval = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
    if (streamRef) {
      for (const track of streamRef.getTracks()) {
        try { track.stop(); } catch {}
      }
      streamRef = null;
    }
  };

  const stopCapture = () => {
    if (stopped) return;
    stopped = true;
    try {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      } else {
        cleanupMedia();
        callbacks.onEnd();
      }
    } catch {
      cleanupMedia();
      callbacks.onEnd();
    }
  };

  navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })
    .then((stream) => {
      if (stopped) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      streamRef = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm';

      mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      let hasDetectedSpeech = false;
      let speechFrameCount = 0;

      mediaRecorder.onstop = async () => {
        cleanupMedia();
        const blob = new Blob(chunks, { type: mimeType });
        // Ignore silent clicks / faint ambient noise so phantom fake transcripts are never produced
        if (blob.size < 2500 || (audioCtx && !hasDetectedSpeech)) {
          callbacks.onPhaseChange?.('idle');
          callbacks.onEnd();
          return;
        }

        try {
          callbacks.onPhaseChange?.('thinking');
          const form = new FormData();
          form.append('audio', blob, 'speech.webm');
          form.append('lang', lang);
          if (callbacks.hints && callbacks.hints.length > 0) {
            form.append('hints', callbacks.hints.slice(0, 20).join(','));
          }

          const res = await fetch('/api/stt', { method: 'POST', body: form });
          if (!res.ok) {
            callbacks.onPhaseChange?.('idle');
            callbacks.onEnd();
            return;
          }
          const data = (await res.json()) as { transcript?: string };
          const transcript = (data.transcript || '').trim();
          if (transcript) {
            callbacks.onResult(transcript, true);
          } else {
            callbacks.onError('no-speech');
          }
        } catch {
          callbacks.onError('stt_network_error');
          callbacks.onPhaseChange?.('error');
        } finally {
          callbacks.onPhaseChange?.('idle');
          callbacks.onEnd();
        }
      };

      // Strict VAD noise gate + ~900ms end-of-speech pause (rejects ambient noise bursts)
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          audioCtx = new AudioCtx();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const buf = new Uint8Array(analyser.frequencyBinCount);
          let silentSince = Date.now();
          const startedAt = Date.now();

          vadInterval = setInterval(() => {
            if (stopped) return;
            analyser.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i];
            const avgEnergy = sum / buf.length;
            const now = Date.now();

            if (avgEnergy > 28) {
              speechFrameCount += 1;
              if (speechFrameCount >= 4) {
                hasDetectedSpeech = true;
              }
              silentSince = now;
            } else if (hasDetectedSpeech && now - silentSince >= 900) {
              stopCapture();
            } else if (now - startedAt > 18000) {
              stopCapture();
            }
          }, 90);
        }
      } catch {
        // Manual push-to-talk still works cleanly even without AudioContext analyser
      }

      mediaRecorder.start(250);
    })
    .catch(() => {
      cleanupMedia();
      // Fall back transparently to browser SpeechRecognition if getUserMedia fails cleanly
      const fallbackSession = startBrowserSpeechRecognition(lang, callbacks);
      if (!fallbackSession) {
        callbacks.onPhaseChange?.('error');
        callbacks.onError('mic_permission_denied');
        callbacks.onEnd();
      }
    });

  return { stop: stopCapture };
}

function startBrowserSpeechRecognition(
  lang: VoiceLang,
  callbacks: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError: (err: string) => void;
    onEnd: () => void;
    onPhaseChange?: (phase: VoicePhase) => void;
  }
): SpeechSession | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  };
  const SpeechRecognitionCtor = w.SpeechRecognition || w.webkitSpeechRecognition;

  if (!SpeechRecognitionCtor) {
    callbacks.onError('unsupported');
    callbacks.onPhaseChange?.('error');
    return null;
  }

  try {
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang === 'sd' ? 'sd-PK' : lang === 'ur' ? 'ur-PK' : 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    let fullTranscript = '';
    let silenceTimeout: ReturnType<typeof setTimeout> | null = null;

    const resetSilenceWatch = () => {
      if (silenceTimeout) clearTimeout(silenceTimeout);
      if (fullTranscript.trim()) {
        silenceTimeout = setTimeout(() => {
          try { recognition.stop(); } catch {}
        }, 900);
      }
    };

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i][0];
        if (event.results[i].isFinal) {
          fullTranscript += (fullTranscript ? ' ' : '') + item.transcript.trim();
        } else {
          interim += ' ' + item.transcript;
        }
      }
      const combined = (fullTranscript + ' ' + interim).trim();
      callbacks.onResult(combined || fullTranscript, false);
      resetSilenceWatch();
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event?.error === 'no-speech') return;
      if (silenceTimeout) clearTimeout(silenceTimeout);
      callbacks.onPhaseChange?.('error');
      callbacks.onError(event?.error || 'speech_error');
    };

    recognition.onend = () => {
      if (silenceTimeout) clearTimeout(silenceTimeout);
      if (fullTranscript.trim()) {
        callbacks.onResult(fullTranscript.trim(), true);
      }
      callbacks.onPhaseChange?.('idle');
      callbacks.onEnd();
    };

    recognition.start();

    return {
      stop: () => {
        if (silenceTimeout) clearTimeout(silenceTimeout);
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    callbacks.onError('init_failed');
    callbacks.onPhaseChange?.('error');
    return null;
  }
}

export function startSpeechRecognition(
  lang: VoiceLang | string,
  callbacks: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError: (err: string) => void;
    onEnd: () => void;
  }
): SpeechSession | null {
  return startFieldSpeechCapture(lang, callbacks);
}
