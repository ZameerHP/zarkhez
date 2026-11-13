'use client';

import { useEffect } from 'react';

const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, summary, [role="button"], [contenteditable="true"]';

/**
 * Prevents accidental pinch-to-zoom, WebKit gesture zoom, trackpad Ctrl+wheel zoom,
 * and double-tap zoom across installed PWAs and mobile browsers while preserving
 * single-finger scrolling, normal taps/clicks, keyboard accessibility, and text selection.
 */
export function ZoomGuard() {
  useEffect(() => {
    let lastTouchEnd = 0;
    let lastTouchX = 0;
    let lastTouchY = 0;

    const handleGesture = (e: Event) => {
      e.preventDefault();
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0 || e.changedTouches.length !== 1) return;

      const target = e.target as Element | null;
      // Never intercept double-taps on interactive controls so fast clicks never stall.
      if (target?.closest(INTERACTIVE_SELECTOR)) return;

      const touch = e.changedTouches[0];
      const now = Date.now();
      const dt = now - lastTouchEnd;
      const dist = Math.hypot(touch.clientX - lastTouchX, touch.clientY - lastTouchY);

      if (dt > 0 && dt < 300 && dist < 36) {
        e.preventDefault();
      }

      lastTouchEnd = now;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    document.addEventListener('gesturestart', handleGesture, { passive: false });
    document.addEventListener('gesturechange', handleGesture, { passive: false });
    document.addEventListener('gestureend', handleGesture, { passive: false });
    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', handleGesture);
      document.removeEventListener('gesturechange', handleGesture);
      document.removeEventListener('gestureend', handleGesture);
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return null;
}
