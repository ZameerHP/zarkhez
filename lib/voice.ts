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
  setTimeout(() => {
    try {
      const audio = getSharedAudio();
      if (audio) {
        audio.src =
          'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        audio.volume = 0.01;
        audio.play().then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 1;
        }).catch(() => {});
      }
    } catch {
      // ignore
    }
  }, 10);
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

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();

    if (lang === 'ur') {
      const urduVoice =
        voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ur')) ||
        voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith('hi')) ||
        voices.find((v) => v.lang.toLowerCase().includes('arabic') || v.lang.toLowerCase().startsWith('ar'));

      if (urduVoice) {
        utterance.voice = urduVoice;
        utterance.lang = urduVoice.lang;
      } else {
        utterance.lang = 'ur-PK';
      }
      utterance.rate = 0.92;
      utterance.pitch = 1.0;
      callbacks?.onStart?.(Boolean(urduVoice));
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
      callbacks?.onStart?.(true);
    }

    utterance.onend = () => callbacks?.onEnd?.();
    utterance.onerror = () => callbacks?.onEnd?.();
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

  stopSpeaking();

  const cleanText = stripMarkdownForSpeech(text);
  if (!cleanText) {
    callbacks?.onEnd?.();
    return;
  }

  // Prefer Neural Human TTS (/api/tts) with fast 2-second timeout before falling back
  if (navigator.onLine !== false) {
    try {
      const url = `/api/tts?lang=${encodeURIComponent(
        lang
      )}&text=${encodeURIComponent(cleanText.slice(0, 750))}`;
      const audio = getSharedAudio() || new Audio();
      audio.volume = 1;
      audio.src = url;

      let started = false;
      const timeoutId = setTimeout(() => {
        if (!started) {
          audio.pause();
          speakWithBrowserSynthesis(cleanText, lang, callbacks);
        }
      }, 2200);

      audio.onplay = () => {
        started = true;
        clearTimeout(timeoutId);
        callbacks?.onStart?.(true);
      };
      audio.onended = () => {
        clearTimeout(timeoutId);
        callbacks?.onEnd?.();
      };
      audio.onerror = () => {
        clearTimeout(timeoutId);
        speakWithBrowserSynthesis(cleanText, lang, callbacks);
      };

      audio.play().catch(() => {
        clearTimeout(timeoutId);
        speakWithBrowserSynthesis(cleanText, lang, callbacks);
      });
      return;
    } catch {
      // Fallback below
    }
  }

  speakWithBrowserSynthesis(cleanText, lang, callbacks);
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined') return;
  if (sharedAudio) {
    try {
      sharedAudio.pause();
      sharedAudio.currentTime = 0;
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
