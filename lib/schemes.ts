import rawSchemes from '@/data/schemes.json';

export type SchemeStatus = 'ongoing' | 'verify_on_portal' | 'expired';

export interface GovernmentSchemeItem {
  id: string;
  title: {
    en: string;
    ur: string;
    sd?: string;
  };
  province: string;
  department: string;
  officialPortal: string;
  helpline: string;
  status: SchemeStatus;
  lastVerifiedAt: string;
  /** Strict ISO YYYY-MM-DD in Asia/Karachi when an official closing deadline is published */
  expiresAt?: string;
  /** ISO-8601 timestamp of the latest automated official portal check */
  autoCheckedAt?: string;
  /** True when the scheme was automatically transitioned to expired after deadline/closure */
  expiredAutoDetected?: boolean;
  /** Whether the official portal responded normally on the latest server check */
  portalReachable?: boolean;
  /** True when automatically discovered from official .gov.pk portals */
  autoDiscovered?: boolean;
  datesNote: {
    en: string;
    ur: string;
  };
  summary: {
    en: string;
    ur: string;
    sd?: string;
  };
  eligibility: {
    en: string[];
    ur: string[];
  };
  documents: {
    en: string[];
    ur: string[];
  };
  steps: {
    en: string[];
    ur: string[];
  };
  verifiedBy: string;
}

export type SchemesStorageSource = 'supabase' | 'redis' | 'tmp' | 'bundled';

export interface SchemesCatalogResponse {
  schemes: GovernmentSchemeItem[];
  lastAutoCheckAt: string | null;
  source: SchemesStorageSource;
}

const BUNDLED_SCHEMES = rawSchemes as GovernmentSchemeItem[];

const OFFICIAL_PORTAL_HOST_ALLOWLIST = [
  '.gov.pk',
  '.gos.pk',
  '.gop.pk',
  '.gokp.pk',
  '.gob.pk',
  'ztbl.com.pk',
] as const;

/**
 * Returns today's calendar date (YYYY-MM-DD) in Pakistan Standard Time (Asia/Karachi).
 */
export function getTodayPakistanIsoDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }
  const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pkt.toISOString().slice(0, 10);
}

/**
 * Validates strict YYYY-MM-DD ISO dates including real calendar bounds.
 */
export function isValidIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [yStr, mStr, dStr] = value.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Verifies a portal URL is HTTPS and belongs to an official Pakistani government or state ag-bank domain.
 */
export function isOfficialPakistanPortalUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) return false;
    return OFFICIAL_PORTAL_HOST_ALLOWLIST.some((suffix) =>
      suffix.startsWith('.')
        ? host.endsWith(suffix) && host.length > suffix.length
        : host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

/**
 * Applies automatic expiry rules using Asia/Karachi calendar dates.
 * Only transitions schemes to 'expired' when a verified `expiresAt` date has passed;
 * never invents closing dates when none are published.
 */
export function applySchemeExpiryRules(
  scheme: GovernmentSchemeItem,
  todayIso: string = getTodayPakistanIsoDate()
): GovernmentSchemeItem {
  const validExpiry = isValidIsoDateString(scheme.expiresAt) ? scheme.expiresAt : undefined;
  const datesNote = {
    en: scheme.datesNote.en,
    ur: scheme.datesNote.ur,
  };

  if (validExpiry && validExpiry < todayIso) {
    const enTag = `Auto-expired after deadline (${validExpiry})`;
    const urTag = `آخری تاریخ (${validExpiry}) گزرنے پر خودکار بند`;

    if (!datesNote.en.includes(enTag)) {
      datesNote.en = datesNote.en.trim()
        ? `${datesNote.en.trim()} — ${enTag}`
        : enTag;
    }
    if (!datesNote.ur.includes(urTag)) {
      datesNote.ur = datesNote.ur.trim()
        ? `${datesNote.ur.trim()} — ${urTag}`
        : urTag;
    }

    return {
      ...scheme,
      expiresAt: validExpiry,
      status: 'expired',
      expiredAutoDetected: true,
      datesNote,
    };
  }

  return {
    ...scheme,
    expiresAt: validExpiry,
    expiredAutoDetected:
      scheme.status === 'expired' ? Boolean(scheme.expiredAutoDetected) : false,
    datesNote,
  };
}

const STATUS_RANK: Record<SchemeStatus, number> = {
  ongoing: 0,
  verify_on_portal: 1,
  expired: 2,
};

/**
 * Sorts active ('ongoing') and portal-check schemes before 'expired' schemes, preserving input order within ties.
 */
export function sortSchemesActiveFirst(
  list: GovernmentSchemeItem[]
): GovernmentSchemeItem[] {
  return list
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => {
      const rankDiff = (STATUS_RANK[a.item.status] ?? 9) - (STATUS_RANK[b.item.status] ?? 9);
      return rankDiff !== 0 ? rankDiff : a.idx - b.idx;
    })
    .map((entry) => entry.item);
}

export function getBundledSchemes(): GovernmentSchemeItem[] {
  return sortSchemesActiveFirst(
    BUNDLED_SCHEMES.map((s) => applySchemeExpiryRules(s))
  );
}

/**
 * Fetches live auto-updated & auto-expired schemes catalog from `/api/schemes` when in the browser,
 * gracefully falling back to bundled schemes + expiry evaluation if unreachable.
 */
export async function fetchSchemesCatalog(): Promise<SchemesCatalogResponse> {
  if (typeof window === 'undefined') {
    return {
      schemes: getBundledSchemes(),
      lastAutoCheckAt: null,
      source: 'bundled',
    };
  }

  try {
    const res = await fetch('/api/schemes', {
      method: 'GET',
      cache: 'no-store',
    });

    if (res.ok) {
      const payload = (await res.json()) as Partial<SchemesCatalogResponse>;
      if (Array.isArray(payload.schemes) && payload.schemes.length > 0) {
        const today = getTodayPakistanIsoDate();
        const normalized = sortSchemesActiveFirst(
          payload.schemes.map((s) => applySchemeExpiryRules(s, today))
        );
        return {
          schemes: normalized,
          lastAutoCheckAt: payload.lastAutoCheckAt ?? null,
          source: payload.source ?? 'bundled',
        };
      }
    }
  } catch {
    // Fall back gracefully to bundled schemes evaluated against today's date
  }

  return {
    schemes: getBundledSchemes(),
    lastAutoCheckAt: null,
    source: 'bundled',
  };
}

export async function getAvailableSchemes(): Promise<GovernmentSchemeItem[]> {
  const catalog = await fetchSchemesCatalog();
  return catalog.schemes;
}
