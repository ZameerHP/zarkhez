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
import { getLexiconHintsForLang } from './voice/lexicon-loader';
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
const preloadedBlobs = new Map<
  string,
  { blob: Blob; meta: VoiceAudioMeta }
>();

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

export function getSavedVoiceGender(lang: VoiceLang): VoiceGender {
  if (typeof window === 'undefined') return 'female';
  try {
    const perLang = localStorage.getItem(`zarkhez_voice_gender_${lang}`);
    if (perLang === 'male' || perLang === 'female') return perLang;
    const rawProfile = localStorage.getItem('zarkhez_profile');
    if (rawProfile) {
      const p = JSON.parse(rawProfile) as { preferredVoice?: string };
      if (p.preferredVoice && p.preferredVoice.toLowerCase().includes('asad')) {
        return 'male';
      }
    }
  } catch {
    // ignore storage errors
  }
  return 'female';
}

export function setSavedVoiceGender(lang: VoiceLang, gender: VoiceGender): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`zarkhez_voice_gender_${lang}`, gender);
  } catch {
    // ignore
  }
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
      speed: params.speedMode === 'slow' ? 0.75 : 0.9,
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
      if (urduVoice) {
        utterance.voice = urduVoice;
        utterance.lang = urduVoice.lang;
      } else {
        utterance.lang = 'ur-PK';
      }
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

export async function speakText(
  text: string,
  rawLang: VoiceLang | string,
  callbacks?: SpeakCallbacks
): Promise<void> {
  if (typeof window === 'undefined') return;

  stopSpeaking();
  const sessionId = currentVoiceSession;
  const lang = normalizeVoiceLang(rawLang);
  const gender = callbacks?.gender || getSavedVoiceGender(lang);
  const speedMode = callbacks?.speedMode || getSavedVoiceSpeed();
  const targetRate = speedMode === 'slow' ? 0.75 : 0.9;

  lastPlaybackArgs = { text, lang, callbacks };

  const normalized = toSpokenText(text, lang);
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

  const preloadKey = buildClientPreloadKey(spokenText, lang, gender, speedMode);
  const cachedEntry = preloadedBlobs.get(preloadKey);

  const playBlobWithHighlight = async (
    blob: Blob,
    meta: VoiceAudioMeta
  ): Promise<boolean> => {
    if (sessionId !== currentVoiceSession) return true;
    const audio = getSharedAudio() || new Audio();
    revokeActiveUrl();
    const objUrl = URL.createObjectURL(blob);
    activeObjectUrl = objUrl;
    audio.volume = 1;
    audio.playbackRate = targetRate <= 0.8 ? 0.85 : 1.0;

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const done = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimers();
        if (sessionId === currentVoiceSession) {
          callbacks?.onWordHighlight?.(-1, words, meta.spokenText);
        }
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
        callbacks?.onStart?.(true);

        if (words.length > 0) {
          const updateHighlight = () => {
            if (!audio || audio.paused || sessionId !== currentVoiceSession) return;
            const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(2, words.length * 0.42);
            const ratio = Math.min(0.999, Math.max(0, audio.currentTime / dur));
            const idx = Math.min(words.length - 1, Math.floor(ratio * words.length));
            callbacks?.onWordHighlight?.(idx, words, meta.spokenText);
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

      audio.onended = () => {
        done(true);
      };

      audio.onerror = () => {
        done(false);
      };

      audio.src = objUrl;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => done(false));
      }
    });
  };

  try {
    if (cachedEntry) {
      const ok = await playBlobWithHighlight(cachedEntry.blob, cachedEntry.meta);
      if (sessionId === currentVoiceSession) {
        if (ok) {
          callbacks?.onPhaseChange?.('idle');
          callbacks?.onEnd?.();
        } else {
          speakWithOfflineFallback(spokenText, lang, sessionId, speedMode, callbacks);
        }
      }
      return;
    }

    // Stream-like fast start: fetch first 2 short sentences together if <= 3 sentences,
    // or pipeline chunk 0 immediately while prefetching chunk 1 for <1.5s first-audio start!
    const sentences = normalized.sentences;
    const chunks: string[] = [];
    if (sentences.length <= 2) {
      chunks.push(spokenText);
    } else {
      chunks.push(sentences[0]);
      for (let i = 1; i < sentences.length; i += 2) {
        chunks.push(sentences.slice(i, i + 2).join(' '));
      }
    }

    const controller = new AbortController();
    const firstTimeout = setTimeout(() => controller.abort(), 11000);
    const firstResultPromise = fetchTtsBlob({
      text: chunks[0],
      lang,
      gender,
      speedMode,
      clipId: chunks.length === 1 ? callbacks?.clipId : undefined,
      signal: controller.signal,
    }).finally(() => clearTimeout(firstTimeout));

    // Prefetch second chunk in parallel if multi-chunk
    const remainingPromises = chunks.slice(1).map((c) =>
      fetchTtsBlob({
        text: c,
        lang,
        gender,
        speedMode,
      })
    );

    const firstResult = await firstResultPromise;
    if (sessionId !== currentVoiceSession) return;

    if (!firstResult) {
      speakWithOfflineFallback(spokenText, lang, sessionId, speedMode, callbacks);
      return;
    }

    if (chunks.length === 1) {
      if (preloadedBlobs.size >= PRELOAD_CACHE_MAX) {
        const firstKey = preloadedBlobs.keys().next().value;
        if (firstKey) preloadedBlobs.delete(firstKey);
      }
      preloadedBlobs.set(preloadKey, firstResult);
    }

    const firstOk = await playBlobWithHighlight(firstResult.blob, {
      ...firstResult.meta,
      spokenText,
    });
    if (!firstOk) {
      speakWithOfflineFallback(spokenText, lang, sessionId, speedMode, callbacks);
      return;
    }

    for (const p of remainingPromises) {
      if (sessionId !== currentVoiceSession) return;
      const chunkRes = await p;
      if (!chunkRes || sessionId !== currentVoiceSession) break;
      await playBlobWithHighlight(chunkRes.blob, {
        ...chunkRes.meta,
        spokenText,
      });
    }

    if (sessionId === currentVoiceSession) {
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

      mediaRecorder.onstop = async () => {
        cleanupMedia();
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 400) {
          callbacks.onPhaseChange?.('idle');
          callbacks.onEnd();
          return;
        }

        try {
          callbacks.onPhaseChange?.('thinking');
          const form = new FormData();
          form.append('audio', blob, 'speech.webm');
          form.append('lang', lang);
          const hints = callbacks.hints || getLexiconHintsForLang(lang);
          if (hints.length > 0) {
            form.append('hints', hints.slice(0, 45).join(','));
          }

          const res = await fetch('/api/stt', { method: 'POST', body: form });
          if (!res.ok) {
            callbacks.onError('stt_failed');
            callbacks.onPhaseChange?.('error');
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

      // VAD end-of-speech delay (~900ms silence after user spoke)
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
          let hasDetectedSpeech = false;
          let silentSince = Date.now();
          const startedAt = Date.now();

          vadInterval = setInterval(() => {
            if (stopped) return;
            analyser.getByteFrequencyData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i];
            const avgEnergy = sum / buf.length;
            const now = Date.now();

            if (avgEnergy > 14) {
              hasDetectedSpeech = true;
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
