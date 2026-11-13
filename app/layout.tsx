import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zarkhez (زرخیز) — Aap ki kheti, aap ka dost',
  description:
    'Urdu-first AI farming assistant PWA for small farmers in Pakistan. Leaf disease scan, weather alerts, crop calendar, fertilizer & profit calculator.',
  applicationName: 'ZARKHEZ',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ZARKHEZ',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'msapplication-TileColor': '#062409',
  },
};

export const viewport: Viewport = {
  themeColor: '#062409',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
