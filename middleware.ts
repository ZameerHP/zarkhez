import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

// Inner interface routes that MUST NEVER be shown without login & signup
const PROTECTED_ROUTES = [
  '/home',
  '/scan',
  '/assistant',
  '/diary',
  '/profile',
  '/weather',
  '/crop',
  '/tools',
];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let next-intl handle internationalization routing first
  const response = intlMiddleware(req);

  // Check if target is an inner protected interface route
  const isProtected = PROTECTED_ROUTES.some((route) =>
    pathname.includes(route)
  );

  if (isProtected) {
    const authCookie = req.cookies.get('zarkhez_auth')?.value;
    // If not authenticated, NEVER show inner interface - redirect to Welcome/Login/Signup
    if (authCookie !== '1') {
      const matchLocale = pathname.match(/^\/(en|ur)/);
      const locale = matchLocale ? matchLocale[1] : 'ur';
      const redirectUrl = new URL(`/${locale}`, req.url);
      return NextResponse.redirect(redirectUrl);
    }
  }

  return response;
}

export const config = {
  // Match only internationalized pathnames, and automatically redirect un-prefixed paths like /scan -> /ur/scan
  matcher: ['/((?!api|_next|_vercel|images|icons|sw.js|favicon.ico|.*\\..*).*)'],
};
