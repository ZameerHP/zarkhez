export type VoiceLang = 'ur' | 'sd' | 'en';
export type VoiceLocaleCode = 'ur-PK' | 'sd-PK' | 'en-PK';
export type VoiceGender = 'female' | 'male';
export type VoiceSpeedMode = 'slow' | 'normal';
export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type VoiceProviderId =
  | 'native-recording'
  | 'disk-cache'
  | 'elevenlabs-v3'
  | 'gemini-tts'
  | 'azure-neural'
  | 'google-cloud-tts'
  | 'mms-sindhi'
  | 'browser-offline-fallback';

export type SttProviderId =
  | 'gemini-audio-stt'
  | 'openai-whisper'
  | 'assemblyai'
  | 'google-cloud-stt'
  | 'browser-web-speech';

export interface LexiconEntry {
  id: string;
  term: string;
  aliases: string[];
  category: string;
  spokenUr: string;
  spokenSd: string;
  spokenEn: string;
  ipaUr?: string;
  ipaSd?: string;
  ipaEn?: string;
  needs_native_review?: boolean;
}

export interface NormalizedSpokenResult {
  originalText: string;
  spokenText: string;
  sentences: string[];
  words: string[];
  lang: VoiceLang;
  localeCode: VoiceLocaleCode;
  needsNativeReview: boolean;
  appliedLexiconIds: string[];
  preservesSindhiLetters: boolean;
}

export interface TTSRequest {
  text: string;
  lang: VoiceLang;
  gender?: VoiceGender;
  speedMode?: VoiceSpeedMode;
  speedRate?: number;
  clipId?: string;
  preferProvider?: VoiceProviderId;
  skipCache?: boolean;
}

export interface TTSResult {
  audioBuffer: Uint8Array;
  contentType: 'audio/wav' | 'audio/mpeg';
  provider: VoiceProviderId;
  voiceLabel: string;
  localeCode: VoiceLocaleCode;
  audioId: string;
  cacheStatus: 'hit' | 'miss' | 'native';
  spokenText: string;
  latencyMs: number;
}

export interface STTRequest {
  audioBase64: string;
  mimeType: string;
  lang: VoiceLang;
  hints?: string[];
}

export interface STTResult {
  transcript: string;
  localeCode: VoiceLocaleCode;
  provider: SttProviderId;
  latencyMs: number;
  confidence?: number;
}

export const VOICE_LOCALE_MAP: Record<VoiceLang, VoiceLocaleCode> = {
  ur: 'ur-PK',
  sd: 'sd-PK',
  en: 'en-PK',
};
