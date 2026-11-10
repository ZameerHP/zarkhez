'use client';

import React, { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  ArrowLeft,
  Volume2,
  Square,
  Download,
  CheckCircle2,
  Star,
} from 'lucide-react';
import voiceTestSet from '@/data/voice/voice-test-set.json';
import { toSpokenText } from '@/lib/voice/spoken-normalizer';
import type { VoiceGender, VoiceLang } from '@/lib/voice/types';

interface RatingRow {
  evaluator: string;
  lang: VoiceLang;
  phraseId: string;
  sampleLabel: 'A' | 'B';
  gender: VoiceGender;
  clarity: number;
  naturalness: number;
  accent: number;
  numberCorrectness: number;
  winner?: 'A' | 'B' | 'Tie';
  notes: string;
  timestamp: string;
}

export default function VoiceListeningTestPage() {
  const locale = useLocale() as 'en' | 'ur';
  const [selectedLang, setSelectedLang] = useState<'ur' | 'sd'>('ur');
  const [evaluatorName, setEvaluatorName] = useState('Evaluator 1');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [playingSide, setPlayingSide] = useState<'A' | 'B' | null>(null);
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  const [currentScore, setCurrentScore] = useState({
    sampleLabel: 'A' as 'A' | 'B',
    clarity: 5,
    naturalness: 5,
    accent: 5,
    numberCorrectness: 5,
    winner: 'A' as 'A' | 'B' | 'Tie',
    notes: '',
  });
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const phrases = selectedLang === 'ur' ? voiceTestSet.urdu : voiceTestSet.sindhi;
  const activePhrase = phrases[phraseIdx] || phrases[0];

  const spokenForm = useMemo(
    () => toSpokenText(activePhrase.text, selectedLang),
    [activePhrase.text, selectedLang]
  );

  // Blinded A = female voice (normal), B = male voice (normal) — or swaps A/B cleanly per phrase index
  const sideMap = useMemo(() => {
    const even = phraseIdx % 2 === 0;
    return {
      A: { gender: (even ? 'female' : 'male') as VoiceGender },
      B: { gender: (even ? 'male' : 'female') as VoiceGender },
    };
  }, [phraseIdx]);

  const stopPlayback = () => {
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
    setPlayingSide(null);
  };

  const playBlindSample = async (side: 'A' | 'B') => {
    stopPlayback();
    setPlayingSide(side);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: activePhrase.text,
          lang: selectedLang,
          gender: sideMap[side].gender,
          speedMode: 'normal',
        }),
      });
      if (!res.ok) {
        setPlayingSide(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      setAudioEl(el);
      el.onended = () => {
        setPlayingSide(null);
        URL.revokeObjectURL(url);
      };
      el.onerror = () => {
        setPlayingSide(null);
        URL.revokeObjectURL(url);
      };
      await el.play();
    } catch {
      setPlayingSide(null);
    }
  };

  const handleSaveRating = (e: React.FormEvent) => {
    e.preventDefault();
    const row: RatingRow = {
      evaluator: evaluatorName,
      lang: selectedLang,
      phraseId: activePhrase.id,
      sampleLabel: currentScore.sampleLabel,
      gender: sideMap[currentScore.sampleLabel].gender,
      clarity: currentScore.clarity,
      naturalness: currentScore.naturalness,
      accent: currentScore.accent,
      numberCorrectness: currentScore.numberCorrectness,
      winner: currentScore.winner,
      notes: currentScore.notes.trim(),
      timestamp: new Date().toISOString(),
    };
    setRatings((prev) => [row, ...prev]);
    setCurrentScore((s) => ({ ...s, notes: '' }));
    if (phraseIdx < phrases.length - 1) {
      setPhraseIdx((i) => i + 1);
    }
  };

  const handleExportCsv = () => {
    const header =
      'evaluator,lang,phraseId,sampleLabel,gender,clarity,naturalness,accent,numberCorrectness,winner,notes,timestamp\n';
    const body = ratings
      .map((r) =>
        [
          r.evaluator,
          r.lang,
          r.phraseId,
          r.sampleLabel,
          r.gender,
          r.clarity,
          r.naturalness,
          r.accent,
          r.numberCorrectness,
          r.winner || '',
          `"${r.notes.replace(/"/g, '""')}"`,
          r.timestamp,
        ].join(',')
      )
      .join('\n');

    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zarkhez-listening-eval-${selectedLang}.csv`;
    a.click();
  };

  const aggregate = useMemo(() => {
    const filtered = ratings.filter((r) => r.lang === selectedLang);
    if (filtered.length === 0) return null;
    const avg = (fn: (r: RatingRow) => number) =>
      (filtered.reduce((a, r) => a + fn(r), 0) / filtered.length).toFixed(2);
    const overall =
      filtered.reduce(
        (a, r) => a + (r.clarity + r.naturalness + r.accent + r.numberCorrectness) / 4,
        0
      ) / filtered.length;
    return {
      count: filtered.length,
      clarity: avg((r) => r.clarity),
      naturalness: avg((r) => r.naturalness),
      accent: avg((r) => r.accent),
      numberCorrectness: avg((r) => r.numberCorrectness),
      overall: overall.toFixed(2),
      passesTarget: overall >= 4.0,
    };
  }, [ratings, selectedLang]);

  return (
    <div className="min-h-screen bg-[#f4f7f2] text-[#0c1a12] p-4 sm:p-6" dir="ltr">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="flex items-center justify-between gap-3 bg-white rounded-3xl p-4 shadow-sm border border-[#dce6da]">
          <div className="flex items-center gap-3">
            <Link
              href="/home"
              locale={locale}
              className="w-10 h-10 rounded-full bg-[#eef3ec] flex items-center justify-center text-[#165b33]"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-extrabold text-[#0c1a12]">
                Zarkhez Native Voice Listening Test (A/B Panel)
              </h1>
              <p className="text-xs text-[#4a5d52]">
                60 Urdu &amp; 60 Sindhi test phrases • 5 native reviewers target &ge; 4.0 / 5.0
              </p>
            </div>
          </div>
          {ratings.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3.5 py-2 rounded-full bg-[#165b33] text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV ({ratings.length})
            </button>
          )}
        </header>

        {/* Evaluator & Language Controls */}
        <section className="bg-white rounded-3xl p-4 shadow-sm border border-[#dce6da] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {(['Evaluator 1', 'Evaluator 2', 'Evaluator 3', 'Evaluator 4', 'Evaluator 5'] as const).map(
              (ev) => (
                <button
                  key={ev}
                  type="button"
                  onClick={() => setEvaluatorName(ev)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                    evaluatorName === ev
                      ? 'bg-[#165b33] text-white'
                      : 'bg-[#eef3ec] text-[#165b33]'
                  }`}
                >
                  {ev}
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                stopPlayback();
                setSelectedLang('ur');
                setPhraseIdx(0);
              }}
              className={`px-4 py-1.5 rounded-full text-xs font-extrabold ${
                selectedLang === 'ur'
                  ? 'bg-[#062409] text-white'
                  : 'bg-[#eef3ec] text-[#0c1a12]'
              }`}
            >
              Urdu (ur-PK • 60)
            </button>
            <button
              type="button"
              onClick={() => {
                stopPlayback();
                setSelectedLang('sd');
                setPhraseIdx(0);
              }}
              className={`px-4 py-1.5 rounded-full text-xs font-extrabold ${
                selectedLang === 'sd'
                  ? 'bg-[#062409] text-white'
                  : 'bg-[#eef3ec] text-[#0c1a12]'
              }`}
            >
              Sindhi (sd-PK • 60)
            </button>
          </div>
        </section>

        {/* Active Phrase & Blind A/B Playback */}
        <section className="bg-white rounded-3xl p-5 shadow-sm border border-[#dce6da] space-y-4">
          <div className="flex items-center justify-between text-xs text-[#4a5d52]">
            <span className="font-bold uppercase tracking-wide">
              Phrase {phraseIdx + 1} / {phrases.length} • Category: {activePhrase.category} ({activePhrase.id})
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setPhraseIdx((i) => Math.max(0, i - 1))}
                className="px-2.5 py-1 rounded-lg bg-[#eef3ec] font-bold"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPhraseIdx((i) => Math.min(phrases.length - 1, i + 1))}
                className="px-2.5 py-1 rounded-lg bg-[#eef3ec] font-bold"
              >
                Next
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-2xl bg-[#f7faf6] p-4 border border-[#e3eae1]" dir="rtl">
            <p className="text-base font-bold text-[#0c1a12]">{activePhrase.text}</p>
            <p className="text-xs text-[#4a5d52]">
              <strong>Spoken-form normalized:</strong> {spokenForm.spokenText}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(['A', 'B'] as const).map((side) => {
              const isPlaying = playingSide === side;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => (isPlaying ? stopPlayback() : void playBlindSample(side))}
                  className={`py-3.5 px-4 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 transition ${
                    isPlaying
                      ? 'bg-amber-500 text-white'
                      : 'bg-[#165b33] hover:bg-[#114828] text-white'
                  }`}
                >
                  {isPlaying ? <Square className="w-4 h-4 fill-current" /> : <Volume2 className="w-4 h-4" />}
                  <span>{isPlaying ? `Stop Sample ${side}` : `Play Blind Voice ${side}`}</span>
                </button>
              );
            })}
          </div>

          {/* 1-5 Rating Form */}
          <form onSubmit={handleSaveRating} className="space-y-4 pt-2 border-t border-[#e3eae1]">
            <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
              <span>Scoring for sample:</span>
              {(['A', 'B'] as const).map((s) => (
                <label key={s} className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="sampleLabel"
                    checked={currentScore.sampleLabel === s}
                    onChange={() => setCurrentScore((prev) => ({ ...prev, sampleLabel: s }))}
                  />
                  Voice {s}
                </label>
              ))}
              <span className="ms-auto">Preferred A/B Winner:</span>
              {(['A', 'B', 'Tie'] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setCurrentScore((prev) => ({ ...prev, winner: w }))}
                  className={`px-3 py-1 rounded-full ${
                    currentScore.winner === w ? 'bg-[#165b33] text-white' : 'bg-[#eef3ec]'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  ['clarity', 'Clarity (1-5)'],
                  ['naturalness', 'Naturalness (1-5)'],
                  ['accent', 'Authentic Rural Accent (1-5)'],
                  ['numberCorrectness', 'Numbers & Units Accuracy (1-5)'],
                ] as const
              ).map(([field, label]) => (
                <div key={field} className="rounded-xl bg-[#f7faf6] p-3 border border-[#e3eae1]">
                  <span className="block text-xs font-bold mb-1.5">{label}</span>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <button
                        key={score}
                        type="button"
                        onClick={() =>
                          setCurrentScore((prev) => ({ ...prev, [field]: score }))
                        }
                        className={`flex-1 py-1.5 rounded-lg text-xs font-extrabold inline-flex items-center justify-center gap-0.5 ${
                          currentScore[field] === score
                            ? 'bg-[#165b33] text-white'
                            : 'bg-white border border-[#dce6da] text-[#0c1a12]'
                        }`}
                      >
                        <Star className="w-3 h-3" />
                        {score}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <input
              type="text"
              value={currentScore.notes}
              onChange={(e) => setCurrentScore((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional native feedback (e.g. mispronounced letter or suggested phrasing)"
              className="w-full rounded-xl bg-[#f7faf6] border border-[#dce6da] px-3.5 py-2.5 text-xs"
            />

            <button
              type="submit"
              className="w-full py-3 rounded-2xl bg-[#062409] hover:bg-[#114828] text-white font-extrabold text-sm flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Save Rating &amp; Advance to Next Phrase
            </button>
          </form>
        </section>

        {aggregate && (
          <section className="bg-white rounded-3xl p-4 shadow-sm border border-[#dce6da] text-xs space-y-2">
            <div className="flex items-center justify-between">
              <strong className="text-sm">
                Aggregate Panel Score ({selectedLang.toUpperCase()}, {aggregate.count} ratings)
              </strong>
              <span
                className={`px-3 py-1 rounded-full font-extrabold ${
                  aggregate.passesTarget
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                Overall: {aggregate.overall} / 5.0 {aggregate.passesTarget ? '(Target >= 4.0 Met)' : '(Needs tuning)'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-2 rounded-xl bg-[#f7faf6]">Clarity: <strong>{aggregate.clarity}</strong></div>
              <div className="p-2 rounded-xl bg-[#f7faf6]">Natural: <strong>{aggregate.naturalness}</strong></div>
              <div className="p-2 rounded-xl bg-[#f7faf6]">Accent: <strong>{aggregate.accent}</strong></div>
              <div className="p-2 rounded-xl bg-[#f7faf6]">Numbers: <strong>{aggregate.numberCorrectness}</strong></div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
