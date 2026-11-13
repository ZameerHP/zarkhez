'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Navigation, ChevronRight, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { GeocodePlace } from '@/lib/weather';

export const POPULAR_PLACES: GeocodePlace[] = [
  { id: 1, name: 'Faisalabad', admin1: 'Punjab', latitude: 31.418, longitude: 73.079 },
  { id: 2, name: 'Sahiwal', admin1: 'Punjab', latitude: 30.6682, longitude: 73.1114 },
  { id: 3, name: 'Lahore', admin1: 'Punjab', latitude: 31.5204, longitude: 74.3587 },
  { id: 4, name: 'Sargodha', admin1: 'Punjab', latitude: 32.0836, longitude: 72.6711 },
  { id: 5, name: 'Gujranwala', admin1: 'Punjab', latitude: 32.1877, longitude: 74.1945 },
  { id: 6, name: 'Rahim Yar Khan', admin1: 'Punjab', latitude: 28.4202, longitude: 70.3013 },
  { id: 7, name: 'Bahawalpur', admin1: 'Punjab', latitude: 29.3956, longitude: 71.6836 },
  { id: 8, name: 'Multan', admin1: 'Punjab', latitude: 30.1575, longitude: 71.5249 },
  { id: 9, name: 'Hyderabad', admin1: 'Sindh', latitude: 25.396, longitude: 68.3578 },
  { id: 12, name: 'Mirpur Khas', admin1: 'Sindh', latitude: 25.5276, longitude: 69.0126 },
  { id: 10, name: 'Mardan', admin1: 'KPK', latitude: 34.1986, longitude: 72.0404 },
  { id: 11, name: 'Swat', admin1: 'KPK', latitude: 35.2227, longitude: 72.4258 },
];

interface LocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPlace: (placeName: string, lat: number, lon: number) => void;
}

export function LocationPickerModal({
  isOpen,
  onClose,
  onSelectPlace,
}: LocationPickerModalProps) {
  const tWelcome = useTranslations('welcome');
  const locale = useLocale() as 'ur' | 'en';

  const [detectingGps, setDetectingGps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodePlace[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleUseGps = () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;
    setDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDetectingGps(false);
        onSelectPlace(
          locale === 'ur' ? 'میرا کھیت (GPS)' : 'My Farm (GPS)',
          pos.coords.latitude,
          pos.coords.longitude
        );
      },
      () => setDetectingGps(false),
      { timeout: 6000 }
    );
  };

  const handleSearchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim().length < 2) return;
    setSearchError(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSearchResults([]);
      setSearchError(
        locale === 'ur'
          ? 'تلاش کے لیے انٹرنیٹ درکار ہے — نیچے مشہور شہر منتخب کریں۔'
          : 'City search needs internet — choose a popular district below.'
      );
      return;
    }
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(searchQuery.trim())}`
      );
      if (!res.ok) throw new Error('Geocode failed');
      const data = await res.json();
      setSearchResults(data.places || []);
    } catch {
      setSearchResults([]);
      setSearchError(
        locale === 'ur'
          ? 'تلاش اس وقت دستیاب نہیں — نیچے مشہور شہر منتخب کریں۔'
          : 'Search unavailable right now — choose a popular district below.'
      );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[75] bg-black/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[420px] max-h-[90dvh] overflow-y-auto overscroll-contain bg-white rounded-card p-4 sm:p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-5 h-5 text-olive flex-shrink-0" />
                <h3 className="font-extrabold text-base text-ink truncate">
                  {tWelcome('locationTitle')}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-11 h-11 -me-2 rounded-full bg-canvas hover:bg-olive/10 flex items-center justify-center text-ink/65 flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleUseGps}
              disabled={detectingGps}
              className="w-full min-h-[46px] bg-olive hover:bg-olive-dark text-white font-bold rounded-full px-4 py-2 flex items-center justify-center gap-2 text-sm shadow-soft"
            >
              <Navigation className="w-4 h-4" />
              <span>
                {detectingGps ? tWelcome('detectingGps') : tWelcome('useGps')}
              </span>
            </button>

            <form onSubmit={handleSearchPlace} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tWelcome('searchPlaceholder')}
                className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-full bg-canvas border border-olive/25 text-ink text-base sm:text-sm"
              />
              <button
                type="submit"
                className="min-h-[44px] px-4 rounded-full bg-ink text-white text-xs font-bold flex-shrink-0"
              >
                {tWelcome('searchBtn')}
              </button>
            </form>

            {searchError && (
              <p className="text-xs font-bold text-alert-amber bg-cream px-3 py-2 rounded-xl border border-alert-amber/30">
                {searchError}
              </p>
            )}

            {searchResults.length > 0 && (
              <div className="max-h-32 overflow-y-auto space-y-1">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      onSelectPlace(
                        `${p.name}${p.admin1 ? `, ${p.admin1}` : ''}`,
                        p.latitude,
                        p.longitude
                      )
                    }
                    className="w-full px-3 py-2 rounded-tile bg-canvas hover:bg-olive/15 text-start text-xs font-bold text-ink flex items-center justify-between"
                  >
                    <span>
                      {p.name}
                      {p.admin1 ? `, ${p.admin1}` : ''}
                    </span>
                    <ChevronRight className="w-4 h-4 text-olive rtl:rotate-180" />
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5 pt-1">
              {POPULAR_PLACES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onSelectPlace(
                      `${p.name}, ${p.admin1}`,
                      p.latitude,
                      p.longitude
                    )
                  }
                  className="px-3 py-1.5 rounded-full bg-canvas hover:bg-olive hover:text-white text-xs font-bold text-ink border border-olive/20 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
