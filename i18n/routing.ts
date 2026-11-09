import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['ur', 'en'],
  defaultLocale: 'ur',
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
