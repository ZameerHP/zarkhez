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
  '/admin',
];

export default function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Let next-intl handle internationalization routing first
  const response = intlMiddleware(req);
  const authCookie = req.cookies.get('zarkhez_auth')?.value;
  const matchLocale = pathname.match(/^\/(en|ur)(?:\/|$)/);
  const locale = matchLocale ? matchLocale[1] : routing.defaultLocale;

  // Returning authenticated farmers opening root welcome URL enter /home automatically (zero repeat login)
  const isRootWelcome =
    pathname === '/' ||
    pathname === '/ur' ||
    pathname === '/en' ||
    pathname === '/ur/' ||
    pathname === '/en/';

  if (
    isRootWelcome &&
    authCookie === '1' &&
    !searchParams.has('switch') &&
    !searchParams.has('logout')
  ) {
    return NextResponse.redirect(new URL(`/${locale}/home`, req.url));
  }

  // Check if target is an inner protected interface route
  const isProtected = PROTECTED_ROUTES.some((route) =>
    pathname.includes(route)
  );

  // Allow Supabase OAuth return (?code=...) so client exchanges code and sets cookie cleanly
  const isOAuthReturn = searchParams.has('code');

  if (isProtected && authCookie !== '1' && !isOAuthReturn) {
    const redirectUrl = new URL(`/${locale}`, req.url);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  // Match only internationalized pathnames, and automatically redirect un-prefixed paths like /scan -> /ur/scan
  matcher: ['/((?!api|_next|_vercel|images|icons|sw.js|favicon.ico|.*\\..*).*)'],
};
