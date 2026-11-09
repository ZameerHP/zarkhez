import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Zarkhez (زرخیز) — Aap ki kheti, aap ka dost',
  description:
    'Urdu-first AI farming assistant PWA for small farmers in Pakistan. Leaf disease scan, weather alerts, crop calendar, fertilizer & profit calculator.',
  manifest: '/manifest.json',
  icons: {
    icon: '/images/zarkhez-logo-mark.png',
    apple: '/images/zarkhez-logo-mark.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Zarkhez',
  },
};

export const viewport: Viewport = {
  themeColor: '#062409',
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
