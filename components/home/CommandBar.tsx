'use client';

import React from 'react';
import { Sparkles, Mic } from 'lucide-react';
import { motion } from 'framer-motion';
import { useRouter } from '@/i18n/routing';
import { unlockAudio } from '@/lib/voice';
import {
  FLAGSHIP_SPRING,
  navigateWithSharedTransition,
  triggerHaptic,
} from './motion';

interface CommandBarProps {
  locale: 'ur' | 'en';
}

export function CommandBar({ locale }: CommandBarProps) {
  const router = useRouter();

  const openAdvisor = (withMic: boolean) => {
    unlockAudio();
    triggerHaptic(10);
    navigateWithSharedTransition(
      (href) => router.push(href),
      withMic ? '/assistant?mic=1' : '/assistant'
    );
  };

  return (
    <div className="fixed bottom-[calc(5.15rem+env(safe-area-inset-bottom))] inset-x-0 z-40 pointer-events-none flex justify-center px-4">
      <motion.div
        layoutId="advisor-command-bar"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...FLAGSHIP_SPRING, delay: 0.24 }}
        whileTap={{ scale: 0.97 }}
        style={{ viewTransitionName: 'zrk-advisor-bar' }}
        className="pointer-events-auto w-full max-w-[448px] p-[1px] rounded-full zrk-gold-mint-border shadow-[0_14px_34px_rgba(3,10,6,0.55)]"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => openAdvisor(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openAdvisor(false);
            }
          }}
          className="h-[60px] w-full rounded-full bg-[#091D12]/82 backdrop-blur-[28px] ps-4 pe-2 flex items-center justify-between gap-2.5 cursor-pointer select-none"
          aria-label={
            locale === 'ur'
              ? 'زرعی مشیر سے اردو یا انگریزی میں پوچھیں'
              : 'Ask anything in Urdu or English'
          }
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Sparkles
              className="w-[18px] h-[18px] text-[#D9B863] flex-shrink-0"
              strokeWidth={1.5}
            />
            <span className="text-[13px] sm:text-sm text-[#F6F3EA]/78 truncate font-normal">
              {locale === 'ur'
                ? 'اردو یا انگریزی میں کچھ بھی پوچھیں…'
                : 'Ask anything in Urdu or English…'}
            </span>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={(e) => {
              e.stopPropagation();
              openAdvisor(true);
            }}
            aria-label={
              locale === 'ur' ? 'آواز سے مشورہ لیں' : 'Speak to Advisor'
            }
            className="w-11 h-11 rounded-full bg-gradient-to-br from-[#D9B863] via-[#C8A44E] to-[#9E7C31] text-[#07140D] flex items-center justify-center flex-shrink-0 shadow-[0_0_20px_rgba(217,184,99,0.45)] ring-1 ring-[#F6F3EA]/35"
          >
            <Mic className="w-[19px] h-[19px]" strokeWidth={1.65} />
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
