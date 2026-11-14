'use client';

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

const BUNDLED_SCHEMES = rawSchemes as GovernmentSchemeItem[];
const OVERRIDES_KEY = 'zarkhez_schemes_overrides_v1';

interface SchemeOverride {
  status: SchemeStatus;
  lastVerifiedAt: string;
  verifiedBy: string;
}

function readOverrides(): Record<string, SchemeOverride> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SchemeOverride>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getBundledSchemes(): GovernmentSchemeItem[] {
  return BUNDLED_SCHEMES;
}

export async function getAvailableSchemes(): Promise<GovernmentSchemeItem[]> {
  const overrides = readOverrides();
  if (Object.keys(overrides).length === 0) {
    return BUNDLED_SCHEMES;
  }
  return BUNDLED_SCHEMES.map((scheme) => {
    const patch = overrides[scheme.id];
    return patch ? { ...scheme, ...patch } : scheme;
  });
}

export async function adminUpsertVerifiedScheme(
  scheme: GovernmentSchemeItem
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const overrides = readOverrides();
    overrides[scheme.id] = {
      status: scheme.status,
      lastVerifiedAt: new Date().toISOString().slice(0, 10),
      verifiedBy: scheme.verifiedBy,
    };
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    return true;
  } catch {
    return false;
  }
}
