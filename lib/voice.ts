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
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined' || audioUnlocked) return;
  try {
    const audio = getSharedAudio();
    if (audio) {
      // Tiny silent WAV data URI to bless the shared audio element on mobile
      audio.src =
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      audio.volume = 0.01;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 1;
            audioUnlocked = true;
          })
          .catch(() => {
            audio.volume = 1;
          });
      }
    }
    if ('speechSynthesis' in window) {
      const silentUtterance = new SpeechSynthesisUtterance('');
      silentUtterance.volume = 0;
      window.speechSynthesis.speak(silentUtterance);
    }
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
        voices.find((v) => v.lang.toLowerCase().startsWith('ur')) ||
        voices.find((v) => v.lang.toLowerCase().startsWith('hi'));
      if (urduVoice) {
        utterance.voice = urduVoice;
        utterance.lang = urduVoice.lang;
      } else {
        utterance.lang = 'ur-PK';
      }
      utterance.rate = 0.95;
      utterance.pitch = 1.02;
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

  // Prefer Neural Human TTS (/api/tts) when online for natural, fluent Urdu & English voice
  if (navigator.onLine !== false) {
    try {
      const url = `/api/tts?lang=${encodeURIComponent(
        lang
      )}&text=${encodeURIComponent(cleanText.slice(0, 1400))}`;
      const audio = getSharedAudio() || new Audio();
      audio.volume = 1;
      audio.src = url;

      audio.onplay = () => {
        audioUnlocked = true;
        callbacks?.onStart?.(true);
      };
      audio.onended = () => {
        callbacks?.onEnd?.();
      };
      audio.onerror = () => {
        // Fallback to local browser speechSynthesis if offline or network blocked
        speakWithBrowserSynthesis(cleanText, lang, callbacks);
      };

      audio.play().catch(() => {
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
    recognition.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      callbacks.onResult(transcript, isFinal);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      callbacks.onError(event?.error || 'speech_error');
    };

    recognition.onend = () => {
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
