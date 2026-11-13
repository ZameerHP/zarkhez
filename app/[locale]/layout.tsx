import React from 'react';
import {
  Plus_Jakarta_Sans,
  Noto_Nastaliq_Urdu,
  Noto_Naskh_Arabic,
} from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { PWAProvider } from '@/components/pwa/PWAProvider';
import { PWAOverlays } from '@/components/pwa/PWAOverlays';
import { LaunchSplash, PWA_HEAD_SCRIPT } from '@/components/pwa/LaunchSplash';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

const notoNastaliq = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '700'],
  variable: '--font-nastaliq',
  display: 'swap',
});

const notoNaskh = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-naskh',
  display: 'swap',
});

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const { locale } = params;

  if (!routing.locales.includes(locale as 'en' | 'ur')) {
    notFound();
  }

  const messages = await getMessages();
  const tApp = await getTranslations({ locale, namespace: 'app' });
  const dir = locale === 'ur' ? 'rtl' : 'ltr';

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${plusJakarta.variable} ${notoNastaliq.variable} ${notoNaskh.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PWA_HEAD_SCRIPT }} />
      </head>
      <body className="min-h-[100dvh] bg-canvas text-ink antialiased selection:bg-olive selection:text-white">
        <LaunchSplash tagline={tApp('tagline')} />
        <NextIntlClientProvider messages={messages} locale={locale}>
          <PWAProvider>
            <PWAOverlays />
            <AuthGuard>
              <div className="mx-auto max-w-[480px] min-h-[100dvh] bg-canvas relative shadow-2xl overflow-x-hidden">
                {children}
              </div>
            </AuthGuard>
          </PWAProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
