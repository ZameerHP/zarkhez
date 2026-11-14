'use client';

import type { VoiceLang } from '@/lib/voice';

/**
 * ZARKHEZ Offline Voice Capability & Fallback Probe
 *
 * Truthfully inspects what voice features work when offline:
 * - Pre-cached neural TTS clips in Cache API ('zarkhez-tts-v4')
 * - Local OS SpeechSynthesis voices for en / ur / sd (strictly refusing wrong-language gibberish)
 * - Honestly warns when offline STT is unavailable (browser SpeechRecognition varies by OS/cloud)
 */

export interface OfflineVoiceAudit {
  cachedTtsClipCount: number;
  hasOsVoiceForLanguage: boolean;
  osVoiceName: string | null;
  speechSynthesisSupported: boolean;
  sttOfflineSupported: boolean;
  fallbackMode: 'cached_audio' | 'os_tts' | 'text_only';
  honestNotice: {
    en: string;
    ur: string;
  };
}

export async function auditOfflineVoiceCapabilities(
  lang: VoiceLang
): Promise<OfflineVoiceAudit> {
  let cachedTtsClipCount = 0;
  if (typeof caches !== 'undefined') {
    try {
      const exists = await caches.has('zarkhez-tts-v4');
      if (exists) {
        const cache = await caches.open('zarkhez-tts-v4');
        const keys = await cache.keys();
        cachedTtsClipCount = keys.length;
      }
    } catch {
      // ignore
    }
  }

  const speechSynthesisSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window;
  let osVoiceName: string | null = null;
  let hasOsVoiceForLanguage = false;

  if (speechSynthesisSupported) {
    try {
      let voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
            resolve(window.speechSynthesis.getVoices());
          };
          const onVoices = () => finish();
          window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
          window.setTimeout(finish, 250);
        });
      }
      const targetPrefix = lang === 'sd' ? 'sd' : lang === 'ur' ? 'ur' : 'en';
      const match = voices.find((v) =>
        v.lang.toLowerCase().replace('_', '-').startsWith(targetPrefix)
      );
      if (match) {
        hasOsVoiceForLanguage = true;
        osVoiceName = match.name || match.lang;
      }
    } catch {
      // ignore
    }
  }

  const fallbackMode: OfflineVoiceAudit['fallbackMode'] = hasOsVoiceForLanguage
    ? 'os_tts'
    : cachedTtsClipCount > 0
    ? 'cached_audio'
    : 'text_only';

  const langDisplayEn =
    lang === 'sd' ? 'Sindhi' : lang === 'ur' ? 'Urdu' : 'English';
  const langDisplayUr =
    lang === 'sd' ? 'سندھی' : lang === 'ur' ? 'اردو' : 'انگریزی';

  const honestNotice = hasOsVoiceForLanguage
    ? {
        en: `Offline device voice active for ${langDisplayEn} (${osVoiceName}), plus ${cachedTtsClipCount} cached neural audio clips. Live voice-to-text requires internet on most devices.`,
        ur: `${langDisplayUr} کے لیے فون کی مقامی آواز (${osVoiceName}) اور ${cachedTtsClipCount} محفوظ آڈیو کلپس دستیاب ہیں۔ آواز لکھنے (STT) کے لیے عموماً انٹرنیٹ درکار ہوتا ہے۔`,
      }
    : {
        en: `Your device has no offline ${langDisplayEn} TTS voice installed (${cachedTtsClipCount} cached audio clips available). On-screen text guidance remains 100% readable offline.`,
        ur: `آپ کے فون پر ${langDisplayUr} کی آف لائن آواز انسٹال نہیں (${cachedTtsClipCount} محفوظ کلپس دستیاب)۔ اسکرین پر تحریری رہنمائی مکمل طور پر دستیاب ہے۔`,
      };

  return {
    cachedTtsClipCount,
    hasOsVoiceForLanguage,
    osVoiceName,
    speechSynthesisSupported,
    // Browser Web Speech STT typically streams to cloud engines on Android/Chrome
    sttOfflineSupported: false,
    fallbackMode,
    honestNotice,
  };
}
