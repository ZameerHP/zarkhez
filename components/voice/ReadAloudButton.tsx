'use client';

import React, { useState, useEffect } from 'react';
import { Volume2, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { speakText, stopSpeaking, unlockAudio } from '@/lib/voice';

interface ReadAloudButtonProps {
  text: string;
  lang?: 'ur' | 'en';
  className?: string;
  compact?: boolean;
}

export function ReadAloudButton({
  text,
  lang,
  className = '',
  compact = false,
}: ReadAloudButtonProps) {
  const currentLocale = useLocale() as 'ur' | 'en';
  const t = useTranslations('app');
  const [speaking, setSpeaking] = useState(false);
  const [voiceNote, setVoiceNote] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);

  const targetLang = lang || currentLocale;

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const handleToggle = () => {
    unlockAudio();
    setVoiceFailed(false);
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }

    if (!text || !text.trim()) {
      setVoiceFailed(true);
      return;
    }

    setSpeaking(true);
    speakText(text, targetLang, {
      onStart: (hasNativeVoice) => {
        if (targetLang === 'ur' && !hasNativeVoice) {
          setVoiceNote(true);
        }
      },
      onEnd: () => setSpeaking(false),
      onError: () => {
        setSpeaking(false);
        setVoiceFailed(true);
      },
    });
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleToggle}
        className={`inline-flex items-center justify-center gap-2 min-h-[48px] px-4 py-2 rounded-full font-semibold text-sm transition-all active:scale-95 ${
          speaking
            ? 'bg-alert-amber text-ink shadow-soft'
            : 'bg-olive/12 text-olive-dark hover:bg-olive/20 border border-olive/25'
        } ${className}`}
        aria-label={speaking ? t('stopListening') : t('listen')}
      >
        {speaking ? (
          <Square className="w-4 h-4 fill-current flex-shrink-0" />
        ) : (
          <Volume2 className="w-4 h-4 flex-shrink-0" />
        )}
        {!compact && (
          <span>{speaking ? t('stopListening') : t('listen')}</span>
        )}
      </button>
      {voiceNote && targetLang === 'ur' && !voiceFailed && (
        <span className="text-xs text-ink/65 ps-1">{t('noUrduVoiceNote')}</span>
      )}
      {voiceFailed && (
        <span className="text-[11px] text-amber-800 ps-1">
          {targetLang === 'en' ? 'Audio unavailable right now' : 'آواز فی الحال دستیاب نہیں'}
        </span>
      )}
    </div>
  );
}
