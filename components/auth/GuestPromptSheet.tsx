'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Mail, X } from 'lucide-react';
import { GoogleLogoSvg } from '@/components/cards/FarmerPersonaCard';

interface GuestPromptSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onGoogleSignIn: () => void;
  onEmailSignIn: () => void;
}

export function GuestPromptSheet({
  isOpen,
  onClose,
  onGoogleSignIn,
  onEmailSignIn,
}: GuestPromptSheetProps) {
  const t = useTranslations('auth');
  const locale = useLocale() as 'ur' | 'en';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-ink/65 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="w-full max-w-sm rounded-t-3xl sm:rounded-card bg-[#F4F5EE] border border-olive/30 shadow-2xl p-5 sm:p-6 space-y-4 text-start"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-olive/15 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-olive" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-ink leading-tight">
                {t('saveHistoryPrompt')}
              </h3>
              <p className="text-[11px] text-ink/70 leading-relaxed mt-0.5">
                {t('saveHistorySubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-olive/10 text-ink/50 hover:text-ink"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5 pt-2">
          {/* Google Sign-in */}
          <button
            type="button"
            onClick={onGoogleSignIn}
            className="w-full min-h-[48px] px-4 rounded-full bg-white hover:bg-canvas text-ink font-extrabold text-xs sm:text-sm border-2 border-ink/15 shadow-sm flex items-center justify-center gap-2.5 transition-all"
          >
            <GoogleLogoSvg className="w-4 h-4 flex-shrink-0" />
            <span>{t('signInWithGoogle')}</span>
          </button>

          {/* Email Code */}
          <button
            type="button"
            onClick={onEmailSignIn}
            className="w-full min-h-[48px] px-4 rounded-full bg-olive hover:bg-olive-dark text-white font-extrabold text-xs sm:text-sm shadow-soft flex items-center justify-center gap-2 transition-all"
          >
            <Mail className="w-4 h-4" />
            <span>{t('emailOtpTab')}</span>
          </button>

          {/* Not Now */}
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[40px] rounded-full text-ink/65 hover:text-ink font-bold text-xs transition-colors"
          >
            {t('notNow')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
