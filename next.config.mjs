import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// Unique per build/deploy. Used as the service worker version (/sw.js?v=...),
// so each Vercel deploy ships a fresh worker + fresh caches and triggers the
// in-app "update available" prompt instead of serving stale assets.
const APP_BUILD_VERSION = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  `local-${Date.now().toString(36)}`
).slice(0, 16);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  env: {
    NEXT_PUBLIC_APP_BUILD_VERSION: APP_BUILD_VERSION,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
      },
    ],
  },
  async headers() {
    const baseSecurityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(self), microphone=(self), geolocation=(self), payment=()',
      },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
    ];

    return [
      {
        source: '/(.*)',
        headers: baseSecurityHeaders,
      },
      {
        source: '/api/(.*)',
        headers: [
          ...baseSecurityHeaders,
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
        ],
      },
      {
        // Service worker must always be revalidated so app updates are detected promptly.
        source: '/sw.js',
        headers: [
          ...baseSecurityHeaders,
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          ...baseSecurityHeaders,
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/offline.html',
        headers: [
          ...baseSecurityHeaders,
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/:locale(en|ur)/admin(.*)',
        headers: [
          ...baseSecurityHeaders,
          { key: 'Cache-Control', value: 'no-store, private' },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
