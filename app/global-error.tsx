'use client';

import React from 'react';
import { RefreshCw, Home } from 'lucide-react';

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ur" dir="rtl">
      <body className="min-h-screen bg-[#f4f7f2] text-[#0c1a12] flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl border border-[#e3eae1] text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[#fef3c7] flex items-center justify-center text-2xl">
            🌿
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold text-[#0c1a12]">
              عارضی مسئلہ پیش آ گیا ہے
            </h1>
            <p className="text-sm text-[#4a5d52] leading-relaxed">
              سروس اس وقت دستیاب نہیں ہو سکی۔ براہ کرم چند لمحے بعد دوبارہ کوشش کریں۔
            </p>
            <p className="text-xs text-[#64786c]" dir="ltr">
              Something went wrong temporarily. Please try again.
            </p>
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <button
              type="button"
              onClick={() => reset()}
              className="w-full py-3.5 px-5 rounded-2xl bg-[#165b33] text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#114828] transition"
            >
              <RefreshCw className="w-4 h-4" />
              دوبارہ کوشش کریں / Try Again
            </button>

            <a
              href="/"
              className="w-full py-3 px-5 rounded-2xl bg-[#eef3ec] text-[#165b33] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#e1ebe0] transition"
            >
              <Home className="w-4 h-4" />
              ہوم پیج / Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
