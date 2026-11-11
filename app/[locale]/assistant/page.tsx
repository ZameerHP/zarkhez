'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Mic,
  MicOff,
  Send,
  Sparkles,
  User,
  Volume2,
  VolumeX,
  Square,
} from 'lucide-react';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import { ReadAloudButton } from '@/components/voice/ReadAloudButton';
import {
  isSpeechRecognitionSupported,
  speakText,
  SpeechSession,
  startSpeechRecognition,
  stopSpeaking,
  unlockAudio,
  VoiceLang,
  VoicePhase,
} from '@/lib/voice';
import {
  getSavedFields,
  getSavedProfile,
  saveProfile,
} from '@/lib/supabase/client';
import { getCachedWeather } from '@/lib/weather';

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  spokenContent?: string;
  voiceLang?: VoiceLang;
}

/**
 * Zarkhez Human Voice Agricultural Advisor (app/[locale]/assistant/page.tsx)
 * - Speaks every answer automatically in a smooth, natural, human-sounding Urdu or English voice (/api/tts).
 * - Unlocks mobile audio on user tap so iOS Safari & Android Chrome never block async TTS.
 * - Uses the cropped Zarkhez emblem (/images/zarkhez-logo-mark.png) for the assistant avatar.
 */
export default function AssistantPage() {
  const t = useTranslations('assistant');
  const tApp = useTranslations('app');
  const locale = useLocale() as 'ur' | 'en';

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [inputText, setInputText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [voiceLang, setVoiceLang] = useState<VoiceLang>(locale === 'en' ? 'en' : 'ur');
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [userAvatar, setUserAvatar] = useState('');

  const [contextInfo, setContextInfo] = useState({
    farmerName: '',
    farmerId: '',
    crop: 'wheat',
    region: 'Multan',
    weatherSummary: '28°C',
  });

  const sessionRef = useRef<SpeechSession | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supported = isSpeechRecognitionSupported();
    setSpeechSupported(supported);

    const profile = getSavedProfile();
    const fields = getSavedFields();
    const weather = getCachedWeather();

    setAutoSpeak(profile.autoSpeakVoice !== false);
    if (profile.avatarUrl) setUserAvatar(profile.avatarUrl);

    const primaryCrop =
      fields[0]?.crop || profile.primaryCrops?.[0] || 'wheat';

    setContextInfo({
      farmerName: profile.fullName || '',
      farmerId: profile.farmerId || '',
      crop: primaryCrop,
      region: profile.placeName.split(',')[0] || 'Multan',
      weatherSummary: weather
        ? `${weather.current.temperature}°C, Rain ${
            weather.daily?.[0]?.precipitationProbMax ?? 0
          }%`
        : '28°C Clear',
    });

    const personalWelcome =
      locale === 'en'
        ? 'Assalam-o-Alaikum! I am Zarkhez, your farming assistant. How can I help you?'
        : 'السلام علیکم! میں زرخیز ہوں، آپ کی کھیتی باڑی کی مددگار۔ بتائیے، آج میں آپ کی کیا مدد کر سکتی ہوں؟';

    setMessages([
      {
        id: 'welcome-turn',
        role: 'assistant',
        content: personalWelcome,
        voiceLang: locale === 'en' ? 'en' : 'ur',
      },
    ]);

    return () => {
      stopSpeaking();
    };
  }, [t, locale]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const toggleAutoSpeak = async () => {
    unlockAudio();
    const next = !autoSpeak;
    setAutoSpeak(next);
    if (!next) {
      stopSpeaking();
      setAiSpeaking(false);
    }
    await saveProfile({ autoSpeakVoice: next });
  };

  const speakAssistantReply = (replyText: string, replyLang: VoiceLang = voiceLang) => {
    if (!autoSpeak || !replyText.trim()) return;
    setAiSpeaking(true);
    setVoicePhase('speaking');
    speakText(replyText, replyLang, {
      onPhaseChange: (p) => setVoicePhase(p),
      onStart: () => setAiSpeaking(true),
      onEnd: () => {
        setAiSpeaking(false);
        setVoicePhase('idle');
      },
      onError: () => {
        setAiSpeaking(false);
        setVoicePhase('error');
      },
    });
  };

  const sendQuestion = async (rawQuestion: string) => {
    unlockAudio();
    const question = rawQuestion.trim();
    if (!question || streaming) return;

    const hasSindhiChars = /[ٻڀٺٽڄڃڇڊڌڍڏڙڦڪڳڱڻ۽۾]/.test(question);
    const effectiveVoiceLang: VoiceLang = hasSindhiChars
      ? 'sd'
      : /[\u0600-\u06FF]/.test(question)
      ? voiceLang === 'sd'
        ? 'sd'
        : 'ur'
      : voiceLang;
    if (effectiveVoiceLang !== voiceLang) {
      setVoiceLang(effectiveVoiceLang);
    }

    stopSpeaking();
    setAiSpeaking(false);
    setVoicePhase('thinking');

    const userTurn: ChatTurn = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
    };
    const assistantTurnId = `assistant-${Date.now() + 1}`;

    const nextMessages = [...messages, userTurn];
    setMessages([
      ...nextMessages,
      { id: assistantTurnId, role: 'assistant', content: '', voiceLang: effectiveVoiceLang },
    ]);
    setInputText('');
    setStreaming(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages
            .filter((m) => m.id !== 'welcome-turn')
            .map((m) => ({
              role: m.role,
              content: m.content,
            })),
          context: contextInfo,
          lang: locale,
          voiceLang: effectiveVoiceLang,
          voiceMode: true,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to answer');
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const dual = (await res.json()) as {
          screenText?: string;
          spokenText?: string;
          language?: VoiceLang;
        };
        // Keep ONE exact clean message on screen matching the spoken answer 1:1
        const unifiedText = (dual.spokenText || dual.screenText || '').trim();
        const replyLang: VoiceLang = dual.language || effectiveVoiceLang;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTurnId
              ? { ...m, content: unifiedText, voiceLang: replyLang }
              : m
          )
        );
        if (unifiedText) {
          speakAssistantReply(unifiedText, replyLang);
        } else {
          setVoicePhase('idle');
        }
      } else if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantTurnId
                ? { ...m, content: accumulated, spokenContent: accumulated, voiceLang: effectiveVoiceLang }
                : m
            )
          );
        }
        if (accumulated.trim()) {
          speakAssistantReply(accumulated, effectiveVoiceLang);
        } else {
          setVoicePhase('idle');
        }
      }
    } catch {
      const errText =
        effectiveVoiceLang === 'sd'
          ? 'معاف ڪجو هاري ڀاءُ، رابطي ۾ عارضي رنڊڪ آهي. مهرباني ڪري ٻيهر پڇو.'
          : effectiveVoiceLang === 'ur'
          ? 'معاف کیجیے کسان بھائی، رابطے میں عارضی رکاوٹ آئی ہے۔ براہ کرم دوبارہ پوچھیں۔'
          : 'Sorry, connection interrupted. Please ask again.';
      setVoicePhase('error');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantTurnId
            ? { ...m, content: errText, spokenContent: errText, voiceLang: effectiveVoiceLang }
            : m
        )
      );
    } finally {
      setStreaming(false);
    }
  };

  const handleToggleMic = () => {
    stopSpeaking();
    setAiSpeaking(false);

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (listening) {
      sessionRef.current?.stop();
      setListening(false);
      setVoicePhase('idle');
      return;
    }

    setListening(true);
    setVoicePhase('listening');
    sessionRef.current = startSpeechRecognition(voiceLang, {
      onResult: (transcript, isFinal) => {
        if (!transcript) return;
        setInputText(transcript);
        // Never auto-send phantom messages on background silence; let farmer confirm and press Send
        if (isFinal) {
          setListening(false);
          setVoicePhase('idle');
        }
      },
      onError: () => {
        setListening(false);
        setVoicePhase('idle');
      },
      onEnd: () => {
        setListening(false);
        setVoicePhase('idle');
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuestion(inputText);
  };

  const suggestedChips =
    voiceLang === 'sd'
      ? [
          'ڪڻڪ کي پهريون پاڻي ڪڏهن ڏجي؟',
          'وونئڻن جا پن مڙڻ جو علاج ڇا آهي؟',
          'فصل تي اسپري ڪرڻ جو صحيح وقت؟',
          'ڪڻڪ لاءِ يوريا ڀاڻ ڪيئن ڏجي؟',
        ]
      : [t('chip1'), t('chip2'), t('chip3'), t('chip4')];

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas flex flex-col overflow-x-hidden">
      {/* Header with Cropped Zarkhez Emblem */}
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[32px] px-4 sm:px-5 pt-4 pb-6 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href="/home"
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center text-white"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={34} lightText showText={false} />
          </div>

          <button
            type="button"
            onClick={toggleAutoSpeak}
            className={`min-h-[38px] px-3 py-1 rounded-full text-[11px] sm:text-xs font-extrabold flex items-center gap-1.5 transition-all ${
              autoSpeak
                ? 'bg-olive-fresh text-white shadow-sm'
                : 'glass text-white/80'
            }`}
          >
            {autoSpeak ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{autoSpeak ? t('autoSpeakOn') : t('autoSpeakOff')}</span>
          </button>

          <LanguageToggle variant="glass" />
        </div>

        <div className="mt-3">
          <h1 className="font-extrabold text-xl sm:text-2xl text-white">
            {t('title')}
          </h1>
          <p className="text-xs text-cream mt-0.5">{t('subtitle')}</p>
        </div>

        {/* Voice Language Selector (Urdu ur-PK | Sindhi sd-PK | English en-PK) & State Indicator */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-white/10 p-1">
            {(
              [
                { id: 'ur', label: 'اردو' },
                { id: 'sd', label: 'سنڌي' },
                { id: 'en', label: 'EN' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  stopSpeaking();
                  setAiSpeaking(false);
                  setVoiceLang(opt.id);
                  setMessages((prev) =>
                    prev.length === 1 && prev[0]?.id === 'welcome-turn'
                      ? [
                          {
                            ...prev[0],
                            content:
                              opt.id === 'en'
                                ? 'Assalam-o-Alaikum! I am Zarkhez, your farming assistant. How can I help you?'
                                : opt.id === 'sd'
                                ? 'السلام عليڪم! مان زرخيز آهيان، اوهان جي زراعت جي مددگار. ٻڌايو، اڄ مان اوهان جي ڪهڙي مدد ڪري سگهان ٿي؟'
                                : 'السلام علیکم! میں زرخیز ہوں، آپ کی کھیتی باڑی کی مددگار۔ بتائیے، آج میں آپ کی کیا مدد کر سکتی ہوں؟',
                            voiceLang: opt.id,
                          },
                        ]
                      : prev
                  );
                }}
                className={`px-3 py-1 rounded-full text-xs font-extrabold transition-all ${
                  voiceLang === opt.id
                    ? 'bg-emerald-400 text-[#062409]'
                    : 'text-white/85 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] font-bold text-emerald-200">
            {voicePhase === 'listening'
              ? voiceLang === 'sd'
                ? 'ٻڌي رهيو آهي...'
                : voiceLang === 'ur'
                ? 'سن رہا ہے...'
                : 'Listening...'
              : voicePhase === 'thinking'
              ? voiceLang === 'sd'
                ? 'جواب تيار ٿي رهيو آهي...'
                : voiceLang === 'ur'
                ? 'سوچ رہا ہے...'
                : 'Thinking...'
              : voicePhase === 'speaking'
              ? voiceLang === 'sd'
                ? 'ڳالهائي رهيو آهي...'
                : voiceLang === 'ur'
                ? 'بول رہا ہے...'
                : 'Speaking...'
              : voicePhase === 'error'
              ? voiceLang === 'sd'
                ? 'آواز ٻيهر ٻڌڻ لاءِ بٽڻ دٻايو'
                : voiceLang === 'ur'
                ? 'آواز دوبارہ سننے کے لیے بٹن دبائیں'
                : 'Tap speaker icon to retry voice'
              : ''}
          </span>
        </div>

        {/* Farmer Persona Context Pill */}
        <div className="mt-2.5 px-3 py-1 rounded-full bg-white/10 text-[11px] text-white/90 inline-block max-w-full truncate">
          {t('contextBar', {
            name:
              contextInfo.farmerName ||
              (locale === 'ur' ? 'کسان بھائی' : 'Farmer'),
            crop: contextInfo.crop,
            region: contextInfo.region,
            weather: contextInfo.weatherSummary,
          })}
        </div>
      </header>

      {/* Active Human Voice Equalizer Banner */}
      <AnimatePresence>
        {aiSpeaking && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-4 sm:mx-5 mt-3 bg-[#062409] text-white rounded-full px-4 py-2.5 shadow-lg border border-emerald-400/35 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {/* 5-bar Animated Voice Equalizer */}
              <div className="flex items-center gap-0.5 h-4">
                {[0, 1, 2, 3, 4].map((bar) => (
                  <motion.span
                    key={bar}
                    animate={{ height: ['25%', '100%', '35%'] }}
                    transition={{
                      duration: 0.65,
                      repeat: Infinity,
                      delay: bar * 0.11,
                    }}
                    className="w-1 bg-emerald-400 rounded-full"
                  />
                ))}
              </div>
              <span className="text-xs font-bold truncate">
                {t('speakingNow')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                setAiSpeaking(false);
              }}
              className="px-3 py-1 rounded-full bg-white text-ink text-xs font-extrabold flex items-center gap-1 flex-shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>{tApp('stopListening')}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Messages Area */}
      <main className="flex-1 px-4 sm:px-5 py-4 space-y-4">
        {/* Suggested Question Chips */}
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          {suggestedChips.map((chip, idx) => (
            <motion.button
              key={idx}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => sendQuestion(chip)}
              disabled={streaming}
              className="min-h-[38px] px-3 py-1.5 rounded-full bg-white hover:bg-olive hover:text-white text-ink text-xs font-bold shadow-soft border border-olive/20 transition-all flex items-center gap-1.5 text-start"
            >
              <Sparkles className="w-3.5 h-3.5 text-wheat flex-shrink-0" />
              <span>{chip}</span>
            </motion.button>
          ))}
        </div>

        {/* Chat Bubbles */}
        <div className="space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-start gap-2.5 ${
                  isUser ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {/* Avatar: Cropped Zarkhez Emblem for AI, Google Avatar for User */}
                {isUser ? (
                  userAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userAvatar}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover border border-wheat flex-shrink-0 mt-1"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-wheat text-white flex items-center justify-center flex-shrink-0 mt-1">
                      <User className="w-4 h-4" />
                    </div>
                  )
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-[#062409] border border-emerald-400/40 overflow-hidden flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/images/zarkhez-logo-mark.png"
                      alt="Zarkhez AI"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-card p-3.5 sm:p-4 shadow-soft space-y-2.5 ${
                    isUser
                      ? 'bg-[#062409] text-white'
                      : 'bg-white text-ink border border-olive/12'
                  }`}
                >
                  <p className="whitespace-pre-line text-sm sm:text-base leading-relaxed">
                    {msg.content || (streaming ? t('thinking') : '')}
                  </p>

                  {!isUser && msg.content && (
                    <div className="pt-1 border-t border-olive/10 flex justify-end">
                      <ReadAloudButton
                        text={msg.spokenContent || msg.content}
                        lang={msg.voiceLang || voiceLang}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Large Mic Button + Typing Box */}
        <div className="pt-2 space-y-3">
          {speechSupported ? (
            <div className="flex flex-col items-center">
              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={handleToggleMic}
                className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center shadow-2xl transition-all ${
                  listening
                    ? 'bg-alert-red text-white ring-8 ring-alert-red/25 animate-pulse'
                    : 'bg-olive-fresh hover:bg-olive text-white ring-8 ring-olive/15'
                }`}
                aria-label={listening ? t('micListening') : t('micReady')}
              >
                {listening ? (
                  <MicOff className="w-7 h-7 sm:w-8 sm:h-8" />
                ) : (
                  <Mic className="w-7 h-7 sm:w-8 sm:h-8" />
                )}
              </motion.button>
              <span className="text-xs font-bold text-ink/75 mt-1.5 text-center">
                {listening ? t('micListening') : t('micReady')}
              </span>
            </div>
          ) : (
            <p className="text-xs text-ink/75 bg-cream p-3 rounded-tile text-center">
              {t('noSpeechSupport')}
            </p>
          )}

          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-full p-1.5 shadow-soft border border-olive/25 flex items-center gap-1.5"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                voiceLang === 'sd' ? 'سنڌي ۾ لکو يا مائڪ دٻايو...' : t('inputPlaceholder')
              }
              className="flex-1 min-h-[46px] px-3.5 rounded-full bg-transparent text-ink text-sm sm:text-base focus:outline-none min-w-0"
            />
            <motion.button
              type="submit"
              whileTap={{ scale: 0.94 }}
              disabled={streaming || !inputText.trim()}
              className="min-h-[46px] px-4 sm:px-5 rounded-full bg-[#062409] hover:bg-olive-dark disabled:opacity-45 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-all flex-shrink-0"
            >
              <span>{t('send')}</span>
              <Send className="w-4 h-4 text-emerald-400 rtl:rotate-180" />
            </motion.button>
          </form>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
