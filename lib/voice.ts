/**
 * Human-Like Neural Voice & Speech Recognition Engine (lib/voice.ts)
 * - Uses /api/tts neural MP3 audio stream first for warm, crystal-clear, natural
 *   human Urdu (ur-PK) and English (en-US) speech on any phone or desktop.
 * - Includes unlockAudio() for iOS Safari & Android Chrome so async AI responses
 *   can auto-play smoothly after user tap gestures.
 * - Falls back automatically to Web Speech API (speechSynthesis) when offline.
 * - Supports continuous or single-turn Urdu/English speech recognition.
 */

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

let sharedAudio: HTMLAudioElement | null = null;
let audioUnlocked = false;
let currentVoiceSession = 0;
let activeFallbackTimer: ReturnType<typeof setTimeout> | null = null;

function clearFallbackTimer(): void {
  if (activeFallbackTimer) {
    clearTimeout(activeFallbackTimer);
    activeFallbackTimer = null;
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

/**
 * Call inside any direct user tap/click handler on mobile phones
 * so iOS Safari and Android Chrome allow subsequent async TTS playback.
 * Runs non-blockingly so button clicks navigate in 0ms without delay.
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined' || audioUnlocked) return;
  audioUnlocked = true;
  try {
    // Unlocks mobile audio without touching sharedAudio
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

function speakWithBrowserSynthesis(
  cleanText: string,
  lang: 'ur' | 'en',
  sessionId: number,
  callbacks?: {
    onStart?: (hasNativeVoice: boolean) => void;
    onEnd?: () => void;
    onError?: () => void;
  }
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    callbacks?.onError?.();
    return;
  }
  if (sessionId !== currentVoiceSession) {
    return;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();

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
      utterance.rate = 0.92;
      utterance.pitch = 1.0;
    } else {
      const enVoice =
        voices.find(
          (v) =>
            v.lang.toLowerCase().startsWith('en') &&
            (v.name.includes('Natural') || v.name.includes('Google'))
        ) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
        null;
      if (enVoice) utterance.voice = enVoice;
      utterance.lang = 'en-US';
      utterance.rate = 0.98;
    }

    utterance.onstart = () => {
      if (sessionId !== currentVoiceSession) {
        try { window.speechSynthesis.cancel(); } catch {}
        return;
      }
      callbacks?.onStart?.(true);
    };

    utterance.onend = () => {
      if (sessionId === currentVoiceSession) {
        callbacks?.onEnd?.();
      }
    };

    utterance.onerror = () => {
      if (sessionId === currentVoiceSession) {
        callbacks?.onEnd?.();
      }
    };

    window.speechSynthesis.speak(utterance);
  } catch {
    callbacks?.onError?.();
  }
}

export function speakText(
  text: string,
  lang: 'ur' | 'en',
  callbacks?: {
    onStart?: (hasNativeVoice: boolean) => void;
    onEnd?: () => void;
    onError?: () => void;
  }
): void {
  if (typeof window === 'undefined') return;

  // 1. Immediately terminate and unbind ANY active audio or browser speech
  stopSpeaking();
  const sessionId = currentVoiceSession;

  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    callbacks?.onEnd?.();
    return;
  }

  // 2. Stream high-quality human Neural MP3 audio via /api/tts
  if (navigator.onLine !== false) {
    try {
      const url = `/api/tts?lang=${encodeURIComponent(
        lang
      )}&text=${encodeURIComponent(cleanText.slice(0, 800))}`;

      const audio = getSharedAudio() || new Audio();
      audio.volume = 1;

      let started = false;
      let ended = false;

      const finishOnce = () => {
        if (ended) return;
        ended = true;
        clearFallbackTimer();
        if (sessionId === currentVoiceSession) {
          callbacks?.onEnd?.();
        }
      };

      // Set fallback timer only for slow connection timeout
      activeFallbackTimer = setTimeout(() => {
        if (!started && sessionId === currentVoiceSession) {
          try {
            audio.onplay = null;
            audio.onended = null;
            audio.onerror = null;
            audio.pause();
            audio.src = '';
          } catch {}
          speakWithBrowserSynthesis(cleanText, lang, sessionId, callbacks);
        }
      }, 7000);

      audio.onplay = () => {
        if (sessionId !== currentVoiceSession) {
          try {
            audio.pause();
            audio.src = '';
          } catch {}
          return;
        }
        started = true;
        clearFallbackTimer();
        // Ensure browser speech synthesis is definitely canceled to prevent any dual audio!
        if ('speechSynthesis' in window) {
          try {
            window.speechSynthesis.cancel();
          } catch {}
        }
        callbacks?.onStart?.(true);
      };

      audio.onended = () => {
        finishOnce();
      };

      audio.onerror = () => {
        if (sessionId !== currentVoiceSession) return;
        clearFallbackTimer();
        speakWithBrowserSynthesis(cleanText, lang, sessionId, callbacks);
      };

      audio.src = url;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // If aborted because a new speech session began or user stopped, abort cleanly
          if (sessionId !== currentVoiceSession) return;

          // Autoplay was blocked or format error:
          // Unhook audio completely so it CANNOT play later concurrently!
          audio.onplay = null;
          audio.onended = null;
          audio.onerror = null;
          try {
            audio.pause();
            audio.src = '';
          } catch {}
          clearFallbackTimer();
          speakWithBrowserSynthesis(cleanText, lang, sessionId, callbacks);
        });
      }
      return;
    } catch {
      // Fallback below
    }
  }

  speakWithBrowserSynthesis(cleanText, lang, sessionId, callbacks);
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined') return;
  currentVoiceSession++;
  clearFallbackTimer();

  if (sharedAudio) {
    try {
      sharedAudio.onplay = null;
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

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export interface SpeechSession {
  stop: () => void;
}

export function startSpeechRecognition(
  lang: 'ur' | 'en',
  callbacks: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError: (err: string) => void;
    onEnd: () => void;
  }
): SpeechSession | null {
  if (!isSpeechRecognitionSupported()) {
    callbacks.onError('unsupported');
    return null;
  }

  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  };
  const SpeechRecognitionCtor =
    w.SpeechRecognition || w.webkitSpeechRecognition;

  if (!SpeechRecognitionCtor) {
    callbacks.onError('unsupported');
    return null;
  }

  try {
    const recognition = new SpeechRecognitionCtor();
    // Use ur-PK for Urdu, fall back to ur / hi-IN for South Asian agricultural speech
    recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    let fullTranscript = '';

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
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event?.error === 'no-speech') {
        return;
      }
      callbacks.onError(event?.error || 'speech_error');
    };

    recognition.onend = () => {
      if (fullTranscript.trim()) {
        callbacks.onResult(fullTranscript.trim(), true);
      }
      callbacks.onEnd();
    };

    recognition.start();

    return {
      stop: () => {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    callbacks.onError('init_failed');
    return null;
  }
}
