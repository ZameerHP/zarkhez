'use client';

import React, { useState, useEffect } from 'react';
import { Volume2, Square, Pause, Play, Turtle, Flag } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  getSavedVoiceGender,
  getSavedVoiceSpeed,
  normalizeVoiceLang,
  pauseSpeaking,
  resumeSpeaking,
  setSavedVoiceGender,
  setSavedVoiceSpeed,
  speakText,
  stopSpeaking,
  submitPronunciationReport,
  unlockAudio,
  VoiceAudioMeta,
  VoiceGender,
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
  const [gender, setGender] = useState<VoiceGender>('female');
  const [speedMode, setSpeedMode] = useState<VoiceSpeedMode>('normal');
  const [voiceFailed, setVoiceFailed] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [spokenWords, setSpokenWords] = useState<string[]>([]);
  const [audioMeta, setAudioMeta] = useState<VoiceAudioMeta | null>(null);
  const [showReportBox, setShowReportBox] = useState(false);
  const [badWordInput, setBadWordInput] = useState('');
  const [reportSent, setReportSent] = useState(false);

  useEffect(() => {
    setGender(getSavedVoiceGender(targetLang));
    setSpeedMode(getSavedVoiceSpeed());
    return () => {
      stopSpeaking();
    };
  }, [targetLang]);

  const startPlayback = (nextGender = gender, nextSpeed = speedMode) => {
    unlockAudio();
    setVoiceFailed(false);
    setPaused(false);
    setReportSent(false);

    if (!text || !text.trim()) {
      setVoiceFailed(true);
      setPhase('error');
      return;
    }

    setSpeaking(true);
    setPhase('thinking');

    speakText(text, targetLang, {
      gender: nextGender,
      speedMode: nextSpeed,
      clipId,
      onPhaseChange: (p) => setPhase(p),
      onPauseChange: (isPaused) => setPaused(isPaused),
      onMeta: (m) => setAudioMeta(m),
      onWordHighlight: (idx, words) => {
        setHighlightIndex(idx);
        if (words.length > 0) setSpokenWords(words);
      },
      onStart: () => {
        setSpeaking(true);
        setPaused(false);
      },
      onEnd: () => {
        setSpeaking(false);
        setPaused(false);
        setHighlightIndex(-1);
        setPhase('idle');
      },
      onError: () => {
        setSpeaking(false);
        setPaused(false);
        setHighlightIndex(-1);
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
      setHighlightIndex(-1);
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
    setSavedVoiceSpeed('slow');
    setSpeedMode('slow');
    startPlayback(gender, 'slow');
  };

  const handleToggleGender = () => {
    const next: VoiceGender = gender === 'female' ? 'male' : 'female';
    setGender(next);
    setSavedVoiceGender(targetLang, next);
    if (speaking) {
      startPlayback(next, speedMode);
    }
  };

  const handleSendPronunciationFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = badWordInput.trim() || spokenWords[highlightIndex] || text.slice(0, 40);
    if (!word) return;
    const ok = await submitPronunciationReport({
      word,
      lang: targetLang,
      audioId: audioMeta?.audioId,
      phrase: audioMeta?.spokenText || text.slice(0, 200),
    });
    if (ok) {
      setReportSent(true);
      setBadWordInput('');
      setTimeout(() => setShowReportBox(false), 1600);
    }
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
    <div className="inline-flex flex-col items-start gap-1.5 max-w-full">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleToggle}
          className={`inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-full font-semibold text-sm transition-all active:scale-95 ${
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

        {!compact && (
          <>
            {speaking && (
              <button
                type="button"
                onClick={handlePauseResume}
                className="min-h-[38px] px-3 rounded-full bg-white border border-olive/25 text-ink text-xs font-bold inline-flex items-center gap-1 hover:bg-olive/10"
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{paused ? (targetLang === 'en' ? 'Resume' : 'جاری') : (targetLang === 'en' ? 'Pause' : 'وقفہ')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRepeatSlowly}
              className={`min-h-[38px] px-3 rounded-full border text-xs font-bold inline-flex items-center gap-1 transition-all ${
                speedMode === 'slow' && speaking
                  ? 'bg-olive text-white border-olive'
                  : 'bg-white border-olive/25 text-ink/85 hover:bg-olive/10'
              }`}
              title="Repeat slowly (0.75x)"
            >
              <Turtle className="w-3.5 h-3.5" />
              <span>
                {targetLang === 'sd'
                  ? 'آهستي ٻڌو'
                  : targetLang === 'ur'
                  ? 'آہستہ سنیں'
                  : 'Repeat Slowly'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleToggleGender}
              className="min-h-[38px] px-3 rounded-full bg-white border border-olive/25 text-ink/85 text-xs font-bold hover:bg-olive/10"
              title="Switch male/female voice"
            >
              {gender === 'female'
                ? targetLang === 'sd'
                  ? 'آواز: عورت'
                  : targetLang === 'ur'
                  ? 'آواز: خاتون'
                  : 'Female'
                : targetLang === 'sd'
                ? 'آواز: مرد'
                : targetLang === 'ur'
                ? 'آواز: مرد'
                : 'Male'}
            </button>
          </>
        )}
      </div>

      {/* Live Highlighted Spoken Transcript */}
      {speaking && spokenWords.length > 0 && !compact && (
        <div
          className="w-full rounded-2xl bg-olive/5 border border-olive/15 px-3 py-2 text-xs leading-relaxed text-ink/90"
          dir={targetLang === 'en' ? 'ltr' : 'rtl'}
        >
          {spokenWords.map((w, idx) => (
            <span
              key={`${idx}-${w}`}
              className={`inline-block me-1 px-1 rounded transition-colors ${
                idx === highlightIndex
                  ? 'bg-emerald-600 text-white font-bold'
                  : idx < highlightIndex
                  ? 'text-ink/50'
                  : 'text-ink/85'
              }`}
            >
              {w}
            </span>
          ))}
        </div>
      )}

      {/* Wrong Pronunciation Feedback Trigger */}
      {!compact && (audioMeta || voiceFailed) && (
        <div className="flex flex-col gap-1 w-full">
          <button
            type="button"
            onClick={() => setShowReportBox((v) => !v)}
            className="text-[11px] font-semibold text-ink/60 hover:text-olive inline-flex items-center gap-1 self-start"
          >
            <Flag className="w-3 h-3" />
            <span>
              {targetLang === 'sd'
                ? 'اچار غلط آهي؟ اسان کي ٻڌايو'
                : targetLang === 'ur'
                ? 'تلفظ غلط ہے؟ ہمیں بتائیں'
                : 'Wrong pronunciation? Tell us'}
            </span>
          </button>

          {showReportBox && (
            <form
              onSubmit={handleSendPronunciationFlag}
              className="flex flex-wrap items-center gap-1.5 bg-white border border-olive/20 rounded-xl p-2"
            >
              <input
                type="text"
                value={badWordInput}
                onChange={(e) => setBadWordInput(e.target.value)}
                placeholder={
                  targetLang === 'en'
                    ? 'Which word sounded wrong?'
                    : targetLang === 'sd'
                    ? 'ڪهڙو لفظ غلط پڙهيو ويو؟'
                    : 'کون سا لفظ غلط بولا گیا؟'
                }
                className="flex-1 min-w-[140px] text-xs px-2.5 py-1.5 rounded-lg bg-canvas border border-olive/20"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-olive text-white text-xs font-bold"
              >
                {reportSent
                  ? targetLang === 'en'
                    ? 'Saved ✓'
                    : 'محفوظ ✓'
                  : targetLang === 'en'
                  ? 'Send'
                  : 'بھیجیں'}
              </button>
            </form>
          )}
        </div>
      )}

      {voiceFailed && (
        <div className="text-[11px] text-amber-900 bg-amber-50 px-2.5 py-1.5 rounded-xl border border-amber-200 max-w-md">
          <span className="font-bold block">
            {targetLang === 'sd'
              ? 'هن وقت آواز نه هلي سگهيو، پر مڪمل لکيل ڄاڻ موجود آهي:'
              : targetLang === 'ur'
              ? 'اس وقت آواز نہیں چل سکی، لیکن تحریری معلومات موجود ہیں:'
              : 'Audio unavailable right now; written details are shown:'}
          </span>
          {compact && <span className="block mt-0.5 text-ink/80">{text}</span>}
        </div>
      )}
    </div>
  );
}
