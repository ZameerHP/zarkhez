'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface ZarkhezLogoProps {
  size?: number;
  showText?: boolean;
  lightText?: boolean;
  subtitle?: string;
  animate?: boolean;
}

/**
 * Zarkhez (زرخیز) Brand Logo:
 * Displays the cropped central emblem (/images/zarkhez-logo-mark.png) —
 * the stylized Z with glowing green leaf and field stripes on deep emerald.
 * Do not mirror logos in RTL.
 */
export function ZarkhezLogo({
  size = 40,
  showText = true,
  lightText = false,
  subtitle,
  animate = true,
}: ZarkhezLogoProps) {
  return (
    <div className="inline-flex items-center gap-2 min-[360px]:gap-2.5 select-none min-w-0 max-w-full">
      <motion.div
        dir="ltr"
        initial={animate ? { scale: 0.9, opacity: 0 } : false}
        animate={animate ? { scale: 1, opacity: 1 } : undefined}
        whileHover={{ scale: 1.06, rotate: 1.5 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 320, damping: 20 }}
        style={{ width: size, height: size }}
        className="relative flex-shrink-0 rounded-[13px] bg-[#062409] shadow-md flex items-center justify-center border border-emerald-400/35 overflow-hidden ring-1 ring-black/15"
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/zarkhez-logo-mark.png"
          alt="Zarkhez Logo"
          width={size}
          height={size}
          className="w-full h-full object-cover"
        />
      </motion.div>
      {showText && (
        <div className="flex flex-col min-w-0">
          <div className="flex items-baseline gap-1 min-[360px]:gap-1.5 flex-wrap">
            <span
              className={`font-extrabold tracking-tight text-base min-[360px]:text-lg leading-tight ${
                lightText ? 'text-white' : 'text-ink'
              }`}
            >
              Zarkhez
            </span>
            <span
              className={`font-urduHeading text-sm min-[360px]:text-base leading-loose ${
                lightText ? 'text-cream' : 'text-olive-dark'
              }`}
            >
              زرخیز
            </span>
          </div>
          {subtitle && (
            <span
              className={`text-xs leading-normal truncate ${
                lightText ? 'text-white/85' : 'text-ink/65'
              }`}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
