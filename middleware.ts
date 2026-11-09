import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match only internationalized pathnames, and automatically redirect un-prefixed paths like /scan -> /ur/scan
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
