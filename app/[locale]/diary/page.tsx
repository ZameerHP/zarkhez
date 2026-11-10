'use client';

import React, { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import {
  ArrowLeft,
  Plus,
  Trash2,
  BookOpen,
  Wallet,
  ScanLine,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';
import { BottomNav } from '@/components/layout/BottomNav';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { ZarkhezLogo } from '@/components/layout/ZarkhezLogo';
import {
  addDiaryEntry,
  deleteDiaryEntry,
  DiaryEntry,
  getDiaryEntries,
  getSavedScans,
  restorePersistentSession,
  SavedScan,
  syncSupabaseAuthSession,
} from '@/lib/supabase/client';

/**
 * Farm Diary Screen (Section 11.2 of SPEC.md):
 * - Tabs for Notes, Expenses and Scans.
 * - Monthly summary card with one bar chart (Recharts).
 * - Floating add button.
 */
export default function DiaryPage() {
  const t = useTranslations('diary');
  const tApp = useTranslations('app');
  const locale = useLocale() as 'ur' | 'en';

  const [activeTab, setActiveTab] = useState<'expenses' | 'notes' | 'scans'>(
    'expenses'
  );
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [scans, setScans] = useState<SavedScan[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add entry form state
  const [kind, setKind] = useState<'expense' | 'income' | 'note'>('expense');
  const [category, setCategory] = useState('Fertilizer');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setEntries(getDiaryEntries());
    setScans(getSavedScans());

    restorePersistentSession().then((restored) => {
      if (restored) {
        setEntries(getDiaryEntries());
        setScans(getSavedScans());
      }
    });

    syncSupabaseAuthSession().then((synced) => {
      if (synced) {
        setEntries(getDiaryEntries());
        setScans(getSavedScans());
      }
    });
  }, []);

  const totalIncome = entries
    .filter((e) => e.kind === 'income')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const totalExpense = entries
    .filter((e) => e.kind === 'expense')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const netBalance = totalIncome - totalExpense;

  const chartData = [
    { name: t('totalIncome'), value: totalIncome, color: '#5FA52E' },
    { name: t('totalExpense'), value: totalExpense, color: '#C8962E' },
  ];

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await addDiaryEntry({
        kind,
        category: kind === 'note' ? 'General' : category,
        amount: kind === 'note' ? 0 : Math.max(0, Number(amount) || 0),
        note: note.trim() || category,
        entry_date: new Date().toISOString().slice(0, 10),
      });
      setEntries(getDiaryEntries());
      setShowAddModal(false);
      setAmount('');
      setNote('');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const updated = await deleteDiaryEntry(id);
    setEntries(updated);
  };

  const noteEntries = entries.filter((e) => e.kind === 'note');
  const financialEntries = entries.filter(
    (e) => e.kind === 'expense' || e.kind === 'income'
  );

  return (
    <div className="min-h-[100dvh] pb-32 bg-canvas">
      <header className="bg-gradient-to-b from-[#062409] to-olive-dark text-white rounded-b-[32px] px-4 sm:px-5 pt-4 pb-7 shadow-soft">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Link
              href="/home"
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-full glass flex items-center justify-center text-white"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <ZarkhezLogo size={34} lightText showText={false} />
          </div>
          <LanguageToggle variant="glass" />
        </div>

        <div className="mt-4">
          <h1 className="font-extrabold text-2xl text-white">{t('title')}</h1>
          <p className="text-xs text-cream mt-0.5">{t('subtitle')}</p>
        </div>
      </header>

      <main className="px-5 mt-5 space-y-5">
        {/* Monthly Summary Card with One Recharts Bar Chart (Section 11.2) */}
        <section className="bg-white rounded-card p-5 shadow-soft border border-olive/10 space-y-4">
          <h2 className="font-extrabold text-base text-ink">
            {t('monthlySummary')}
          </h2>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-canvas rounded-tile p-2.5">
              <span className="block text-[11px] text-ink/65">
                {t('totalIncome')}
              </span>
              <bdi dir="ltr" className="font-extrabold text-sm text-olive-dark">
                Rs. {totalIncome.toLocaleString()}
              </bdi>
            </div>
            <div className="bg-canvas rounded-tile p-2.5">
              <span className="block text-[11px] text-ink/65">
                {t('totalExpense')}
              </span>
              <bdi dir="ltr" className="font-extrabold text-sm text-wheat">
                Rs. {totalExpense.toLocaleString()}
              </bdi>
            </div>
            <div className="bg-canvas rounded-tile p-2.5">
              <span className="block text-[11px] text-ink/65">
                {t('netBalance')}
              </span>
              <bdi
                dir="ltr"
                className={`font-extrabold text-sm ${
                  netBalance >= 0 ? 'text-olive-dark' : 'text-alert-red'
                }`}
              >
                Rs. {netBalance.toLocaleString()}
              </bdi>
            </div>
          </div>

          <div dir="ltr" className="h-40 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* 3 Tabs: Expenses & Income, Notes, Saved Scans */}
        <div className="grid grid-cols-3 gap-2 bg-white p-1.5 rounded-full shadow-soft border border-olive/10">
          <button
            type="button"
            onClick={() => setActiveTab('expenses')}
            className={`min-h-[44px] rounded-full font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'expenses'
                ? 'bg-olive text-white shadow-sm'
                : 'text-ink/70 hover:text-ink'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span>{t('tabExpenses')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`min-h-[44px] rounded-full font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'notes'
                ? 'bg-olive text-white shadow-sm'
                : 'text-ink/70 hover:text-ink'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>{t('tabNotes')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('scans')}
            className={`min-h-[44px] rounded-full font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'scans'
                ? 'bg-olive text-white shadow-sm'
                : 'text-ink/70 hover:text-ink'
            }`}
          >
            <ScanLine className="w-4 h-4" />
            <span>{t('tabScans')}</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'expenses' && (
          <section className="space-y-2.5">
            {financialEntries.length === 0 ? (
              <div className="bg-white rounded-card p-6 text-center text-sm text-ink/70 shadow-soft">
                {t('emptyExpenses')}
              </div>
            ) : (
              financialEntries.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-card p-4 shadow-soft border border-olive/10 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          item.kind === 'income'
                            ? 'bg-olive/15 text-olive-dark'
                            : 'bg-cream text-wheat'
                        }`}
                      >
                        {item.category}
                      </span>
                      <bdi dir="ltr" className="text-xs text-ink/55">
                        {item.entry_date}
                      </bdi>
                    </div>
                    <p className="text-sm font-medium text-ink mt-1">
                      {item.note}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <bdi
                      dir="ltr"
                      className={`font-extrabold text-base ${
                        item.kind === 'income'
                          ? 'text-olive-dark'
                          : 'text-wheat'
                      }`}
                    >
                      {item.kind === 'income' ? '+' : '-'}Rs.{' '}
                      {Number(item.amount).toLocaleString()}
                    </bdi>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="p-2 text-ink/40 hover:text-alert-red"
                      aria-label={tApp('delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {activeTab === 'notes' && (
          <section className="space-y-2.5">
            {noteEntries.length === 0 ? (
              <div className="bg-white rounded-card p-6 text-center text-sm text-ink/70 shadow-soft">
                {t('emptyNotes')}
              </div>
            ) : (
              noteEntries.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-card p-4 shadow-soft border border-olive/10 flex items-start justify-between gap-3"
                >
                  <div>
                    <bdi dir="ltr" className="text-xs font-bold text-olive">
                      {item.entry_date}
                    </bdi>
                    <p className="text-sm text-ink mt-1 leading-relaxed">
                      {item.note}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="p-2 text-ink/40 hover:text-alert-red"
                    aria-label={tApp('delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </section>
        )}

        {activeTab === 'scans' && (
          <section className="space-y-3">
            {scans.length === 0 ? (
              <div className="bg-white rounded-card p-6 text-center space-y-3 shadow-soft">
                <p className="text-sm text-ink/70">{t('emptyScans')}</p>
                <Link
                  href="/scan"
                  className="inline-flex items-center gap-2 min-h-[48px] px-5 py-2.5 rounded-full bg-olive text-white font-bold text-sm"
                >
                  <ScanLine className="w-4 h-4" />
                  <span>{tApp('save')}</span>
                </Link>
              </div>
            ) : (
              scans.map((sc) => (
                <div
                  key={sc.id}
                  className="bg-white rounded-card p-4 shadow-soft border border-olive/10 flex items-start gap-3.5"
                >
                  {sc.thumbnailDataUrl && (
                    <img
                      src={sc.thumbnailDataUrl}
                      alt={sc.label}
                      className="w-16 h-16 rounded-2xl object-cover flex-shrink-0 border border-olive/20"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-extrabold text-sm text-ink">
                        {sc.advice?.problem_name?.[locale] || sc.label || (locale === 'ur' ? 'فصل اسکین' : 'Crop Scan')}
                      </h3>
                      <bdi
                        dir="ltr"
                        className="text-xs font-bold px-2 py-0.5 rounded-full bg-olive/15 text-olive-dark"
                      >
                        {Math.round((Number(sc.confidence) || 0) * 100)}%
                      </bdi>
                    </div>
                    <p className="text-xs text-ink/80 mt-1 line-clamp-2">
                      {sc.advice?.summary?.[locale]}
                    </p>
                  </div>
                </div>
              ))
            )}
          </section>
        )}
      </main>

      {/* Floating Add Button (Section 11.2) */}
      <button
        type="button"
        onClick={() => {
          setKind(activeTab === 'notes' ? 'note' : 'expense');
          setShowAddModal(true);
        }}
        className="fixed bottom-24 end-6 z-40 w-14 h-14 rounded-full bg-olive hover:bg-olive-dark text-white shadow-2xl flex items-center justify-center transition-transform active:scale-95"
        aria-label={t('addEntry')}
      >
        <Plus className="w-7 h-7" />
      </button>

      {/* Add Diary Entry Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-[430px] bg-white rounded-card p-5 shadow-2xl space-y-4">
            <h3 className="font-extrabold text-lg text-ink">
              {t('addEntry')}
            </h3>

            <form onSubmit={handleAddEntry} className="space-y-3.5">
              <div className="grid grid-cols-3 gap-2">
                {(['expense', 'income', 'note'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`min-h-[44px] rounded-tile font-bold text-xs ${
                      kind === k
                        ? 'bg-olive text-white'
                        : 'bg-canvas text-ink'
                    }`}
                  >
                    {k === 'expense'
                      ? t('kindExpense')
                      : k === 'income'
                      ? t('kindIncome')
                      : t('kindNote')}
                  </button>
                ))}
              </div>

              {kind !== 'note' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1">
                      {t('category')}
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full min-h-[48px] px-3 rounded-tile bg-canvas border border-olive/25 text-sm font-bold"
                    >
                      <option value="Fertilizer">{t('catFertilizer')}</option>
                      <option value="Seed">{t('catSeed')}</option>
                      <option value="Spray">{t('catSpray')}</option>
                      <option value="Irrigation">{t('catIrrigation')}</option>
                      <option value="Labor">{t('catLabor')}</option>
                      <option value="Crop Sale">{t('catSale')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-ink/75 mb-1">
                      {t('amountPkr')}
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="5000"
                      className="w-full min-h-[48px] px-3.5 rounded-tile bg-canvas border border-olive/25 text-base font-extrabold"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-ink/75 mb-1">
                  {t('noteText')}
                </label>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('notePlaceholder')}
                  className="w-full p-3.5 rounded-tile bg-canvas border border-olive/25 text-sm"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 min-h-[48px] rounded-full bg-canvas text-ink font-bold text-sm"
                >
                  {tApp('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 min-h-[48px] rounded-full bg-olive text-white font-bold text-sm shadow-soft"
                >
                  {tApp('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
