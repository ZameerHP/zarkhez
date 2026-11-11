'use client';

import React, { useState, useEffect } from 'react';
import { Volume2, Square, Pause, Play, Turtle, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  getSavedVoiceSpeed,
  normalizeVoiceLang,
  pauseSpeaking,
  resumeSpeaking,
  setSavedVoiceSpeed,
  speakText,
  stopSpeaking,
  unlockAudio,
  VoiceLang,
  VoicePhase,
  VoiceSpeedMode,
} from '@/lib/voice';

interface ReadAloudButtonProps {
  text: string;
  lang?: 'ur' | 'sd' | 'en';
  clipId?: string;
  className?: string;
  compact?: boolean;
}

export function ReadAloudButton({
  text,
  lang,
  clipId,
  className = '',
  compact = false,
}: ReadAloudButtonProps) {
  const currentLocale = useLocale() as 'ur' | 'en';
  const t = useTranslations('app');
  const targetLang: VoiceLang = normalizeVoiceLang(lang || currentLocale);

  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [speedMode, setSpeedMode] = useState<VoiceSpeedMode>('normal');
  const [hasPlayed, setHasPlayed] = useState(false);
  const [voiceFailed, setVoiceFailed] = useState(false);

  useEffect(() => {
    setSpeedMode(getSavedVoiceSpeed());
    return () => {
      stopSpeaking();
    };
  }, [targetLang]);

  const startPlayback = (nextSpeed = speedMode) => {
    unlockAudio();
    setVoiceFailed(false);
    setPaused(false);

    if (!text || !text.trim()) {
      setVoiceFailed(true);
      setPhase('error');
      return;
    }

    setSpeaking(true);
    setPhase('thinking');

    speakText(text, targetLang, {
      gender: 'female',
      speedMode: nextSpeed,
      clipId,
      onPhaseChange: (p) => setPhase(p),
      onPauseChange: (isPaused) => setPaused(isPaused),
      onStart: () => {
        setSpeaking(true);
        setPaused(false);
        setHasPlayed(true);
      },
      onEnd: () => {
        setSpeaking(false);
        setPaused(false);
        setPhase('idle');
      },
      onError: () => {
        setSpeaking(false);
        setPaused(false);
        setVoiceFailed(true);
        setPhase('error');
      },
    });
  };

  const handleToggle = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      setPaused(false);
      setPhase('idle');
      return;
    }
    startPlayback();
  };

  const handlePauseResume = () => {
    if (!speaking) return;
    if (paused) resumeSpeaking();
    else pauseSpeaking();
  };

  const handleRepeatSlowly = () => {
    const nextMode: VoiceSpeedMode = speedMode === 'slow' ? 'normal' : 'slow';
    setSavedVoiceSpeed(nextMode);
    setSpeedMode(nextMode);
    startPlayback(nextMode);
  };

  const handleReplay = () => {
    startPlayback(speedMode);
  };

  const listenLabel =
    targetLang === 'sd'
      ? speaking
        ? 'آواز روڪيو'
        : 'آواز ۾ ٻڌو'
      : speaking
      ? t('stopListening')
      : t('listen');

  return (
    <div className="inline-flex flex-col items-start gap-1 max-w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleToggle}
          className={`inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 rounded-full font-semibold text-sm transition-all active:scale-95 ${
            speaking
              ? 'bg-alert-amber text-ink shadow-soft'
              : 'bg-olive/12 text-olive-dark hover:bg-olive/20 border border-olive/25'
          } ${className}`}
          aria-label={listenLabel}
        >
          {speaking ? (
            <Square className="w-4 h-4 fill-current flex-shrink-0" />
          ) : (
            <Volume2 className="w-4 h-4 flex-shrink-0" />
          )}
          {!compact && (
            <span>
              {phase === 'thinking'
                ? targetLang === 'sd'
                  ? 'تيار ٿي رهيو آهي...'
                  : targetLang === 'ur'
                  ? 'آواز تیار ہو رہی ہے...'
                  : 'Preparing...'
                : listenLabel}
            </span>
          )}
        </button>

        {!compact && speaking && (
          <button
            type="button"
            onClick={handlePauseResume}
            className="min-h-[38px] px-3 rounded-full bg-white border border-olive/25 text-ink text-xs font-bold inline-flex items-center gap-1 hover:bg-olive/10"
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>
              {paused
                ? targetLang === 'en'
                  ? 'Resume'
                  : 'جاری'
                : targetLang === 'en'
                ? 'Pause'
                : 'وقفہ'}
            </span>
          </button>
        )}

        {!compact && (hasPlayed || speaking || voiceFailed) && (
          <button
            type="button"
            onClick={handleReplay}
            className="min-h-[38px] px-3 rounded-full bg-white border border-olive/25 text-ink text-xs font-bold inline-flex items-center gap-1 hover:bg-olive/10"
            title={targetLang === 'en' ? 'Replay' : 'دوبارہ سنیں'}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{targetLang === 'en' ? 'Replay' : 'دوبارہ'}</span>
          </button>
        )}

        {!compact && (
          <button
            type="button"
            onClick={handleRepeatSlowly}
            className={`min-h-[38px] px-3 rounded-full border text-xs font-bold inline-flex items-center gap-1 transition-all ${
              speedMode === 'slow'
                ? 'bg-olive text-white border-olive'
                : 'bg-white border-olive/25 text-ink/85 hover:bg-olive/10'
            }`}
            title="Toggle slow/normal speed"
          >
            <Turtle className="w-3.5 h-3.5" />
            <span>
              {targetLang === 'sd'
                ? 'آهستي ٻڌو'
                : targetLang === 'ur'
                ? speedMode === 'slow' ? 'عام رفتار' : 'آہستہ سنیں'
                : speedMode === 'slow' ? 'Normal' : 'Slow'}
            </span>
          </button>
        )}
      </div>

      {voiceFailed && (
        <span className="text-[11px] text-amber-800 ps-1">
          {targetLang === 'sd'
            ? 'آواز هن وقت مصروف آهي.'
            : targetLang === 'ur'
            ? 'آواز اس وقت مصروف ہے۔'
            : 'Audio unavailable right now.'}
        </span>
      )}
    </div>
  );
}
