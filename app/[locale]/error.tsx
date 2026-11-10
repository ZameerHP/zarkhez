'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw, Home } from 'lucide-react';

export default function LocaleError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const isEnglish = pathname?.startsWith('/en') ?? false;

  return (
    <div
      className="min-h-screen bg-[#f4f7f2] text-[#0c1a12] flex items-center justify-center p-6"
      dir={isEnglish ? 'ltr' : 'rtl'}
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl border border-[#e3eae1] text-center space-y-6">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-[#fef3c7] flex items-center justify-center text-2xl">
          🌿
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold text-[#0c1a12]">
            {isEnglish ? 'Something went wrong' : 'عارضی مسئلہ پیش آ گیا ہے'}
          </h1>
          <p className="text-sm text-[#4a5d52] leading-relaxed">
            {isEnglish
              ? 'We could not load this page cleanly right now. Your saved records are safe. Please try again.'
              : 'اس وقت یہ صفحہ مکمل طور پر لوڈ نہیں ہو سکا۔ آپ کا محفوظ ڈیٹا محفوظ ہے۔ براہ کرم دوبارہ کوشش کریں۔'}
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="w-full py-3.5 px-5 rounded-2xl bg-[#165b33] text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#114828] transition"
          >
            <RefreshCw className="w-4 h-4" />
            {isEnglish ? 'Try Again' : 'دوبارہ کوشش کریں'}
          </button>

          <a
            href={isEnglish ? '/en/home' : '/ur/home'}
            className="w-full py-3 px-5 rounded-2xl bg-[#eef3ec] text-[#165b33] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#e1ebe0] transition"
          >
            <Home className="w-4 h-4" />
            {isEnglish ? 'Back to Home' : 'ہوم پر واپس جائیں'}
          </a>
        </div>
      </div>
    </div>
  );
}
