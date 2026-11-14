import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import rawSchemes from '@/data/schemes.json';
import { redactSecrets } from '@/lib/error-sanitizer';
import { extractAndParseJson } from '@/lib/json-extractor';
import { executeGeminiWithFailover, hasAnyConfiguredGeminiAccount } from '@/lib/server/gemini-pool';
import {
  applySchemeExpiryRules,
  getTodayPakistanIsoDate,
  isOfficialPakistanPortalUrl,
  isValidIsoDateString,
  sortSchemesActiveFirst,
  type GovernmentSchemeItem,
  type SchemesCatalogResponse,
  type SchemesStorageSource,
} from '@/lib/schemes';

const BUNDLED_SCHEMES = rawSchemes as GovernmentSchemeItem[];
const BUNDLED_IDS = new Set(BUNDLED_SCHEMES.map((s) => s.id));
const REDIS_STATE_KEY = 'zarkhez:schemes_state_v1';
const TMP_STATE_FILE = path.join(os.tmpdir(), 'zarkhez-schemes-state.json');
const MAX_DISCOVERED_SCHEMES = 15;

/** Re-check official portals automatically every 6 hours when traffic hits `/api/schemes` */
export const SCHEMES_AUTO_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

interface PersistedSchemePatch {
  id: string;
  status: GovernmentSchemeItem['status'];
  expiresAt?: string;
  lastVerifiedAt: string;
  autoCheckedAt?: string;
  expiredAutoDetected?: boolean;
  portalReachable?: boolean;
  datesNote?: {
    en: string;
    ur: string;
  };
  verifiedBy?: string;
}

interface PersistedSchemesState {
  lastAutoCheckAt: string | null;
  patches: Record<string, PersistedSchemePatch>;
  discoveredSchemes?: GovernmentSchemeItem[];
}

export interface RefreshSchemesResult extends SchemesCatalogResponse {
  checkedCount: number;
  expiredCount: number;
  discoveredCount: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __zarkhezSchemesState: PersistedSchemesState | undefined;
  // eslint-disable-next-line no-var
  var __zarkhezSchemesRefreshPromise: Promise<RefreshSchemesResult> | undefined;
}

function getSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return null;
  }
}

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

const GovernmentSchemeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{4,80}$/),
  title: z.object({
    en: z.string().min(4).max(160),
    ur: z.string().min(4).max(200),
    sd: z.string().max(200).optional(),
  }),
  province: z.string().min(3).max(60),
  department: z.string().min(3).max(160),
  officialPortal: z.string().refine(isOfficialPakistanPortalUrl, {
    message: 'officialPortal must be a valid HTTPS Pakistani government/ZTBL portal URL',
  }),
  helpline: z.string().min(2).max(100),
  status: z.enum(['ongoing', 'verify_on_portal', 'expired']),
  lastVerifiedAt: z.string().min(8).max(32),
  expiresAt: z.string().optional(),
  autoCheckedAt: z.string().optional(),
  expiredAutoDetected: z.boolean().optional(),
  portalReachable: z.boolean().optional(),
  autoDiscovered: z.boolean().optional(),
  datesNote: z.object({
    en: z.string().min(4).max(300),
    ur: z.string().min(4).max(360),
  }),
  summary: z.object({
    en: z.string().min(10).max(500),
    ur: z.string().min(10).max(600),
    sd: z.string().max(600).optional(),
  }),
  eligibility: z.object({
    en: z.array(z.string().min(3).max(200)).min(1).max(8),
    ur: z.array(z.string().min(3).max(240)).min(1).max(8),
  }),
  documents: z.object({
    en: z.array(z.string().min(2).max(180)).min(1).max(8),
    ur: z.array(z.string().min(2).max(220)).min(1).max(8),
  }),
  steps: z.object({
    en: z.array(z.string().min(4).max(220)).min(1).max(8),
    ur: z.array(z.string().min(4).max(260)).min(1).max(8),
  }),
  verifiedBy: z.string().min(3).max(140),
});

const PersistedPatchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['ongoing', 'verify_on_portal', 'expired']),
  expiresAt: z.string().optional(),
  lastVerifiedAt: z.string().min(1),
  autoCheckedAt: z.string().optional(),
  expiredAutoDetected: z.boolean().optional(),
  portalReachable: z.boolean().optional(),
  datesNote: z
    .object({
      en: z.string(),
      ur: z.string(),
    })
    .optional(),
  verifiedBy: z.string().optional(),
});

const PersistedStateSchema = z.object({
  lastAutoCheckAt: z.string().nullable(),
  patches: z.record(PersistedPatchSchema),
  discoveredSchemes: z.array(GovernmentSchemeSchema).optional(),
});

async function readRawPersistedState(): Promise<{
  state: PersistedSchemesState;
  source: SchemesStorageSource;
}> {
  // 1. Try Supabase public.schemes table if configured and migrated
  const supabase = getSupabaseServiceClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('schemes')
        .select('id, status, expires_at, last_verified_at, auto_checked_at, payload');

      if (!error && Array.isArray(data) && data.length > 0) {
        const patches: Record<string, PersistedSchemePatch> = {};
        const discoveredSchemes: GovernmentSchemeItem[] = [];
        let latestCheck: string | null = null;

        for (const row of data) {
          const id = typeof row.id === 'string' ? row.id : '';
          if (!id) continue;
          const rawPayload =
            row.payload && typeof row.payload === 'object'
              ? (row.payload as Record<string, unknown>)
              : {};
          const checkedAt =
            typeof row.auto_checked_at === 'string'
              ? row.auto_checked_at
              : typeof rawPayload.autoCheckedAt === 'string'
              ? rawPayload.autoCheckedAt
              : undefined;

          if (checkedAt && (!latestCheck || checkedAt > latestCheck)) {
            latestCheck = checkedAt;
          }

          const expiresRaw =
            typeof row.expires_at === 'string'
              ? row.expires_at
              : typeof rawPayload.expiresAt === 'string'
              ? rawPayload.expiresAt
              : undefined;

          patches[id] = {
            id,
            status:
              row.status === 'ongoing' ||
              row.status === 'verify_on_portal' ||
              row.status === 'expired'
                ? row.status
                : 'verify_on_portal',
            expiresAt: isValidIsoDateString(expiresRaw) ? expiresRaw : undefined,
            lastVerifiedAt:
              typeof row.last_verified_at === 'string'
                ? row.last_verified_at
                : getTodayPakistanIsoDate(),
            autoCheckedAt: checkedAt,
            expiredAutoDetected:
              typeof rawPayload.expiredAutoDetected === 'boolean'
                ? rawPayload.expiredAutoDetected
                : undefined,
            portalReachable:
              typeof rawPayload.portalReachable === 'boolean'
                ? rawPayload.portalReachable
                : undefined,
            datesNote:
              rawPayload.datesNote &&
              typeof (rawPayload.datesNote as { en?: unknown }).en === 'string' &&
              typeof (rawPayload.datesNote as { ur?: unknown }).ur === 'string'
                ? {
                    en: (rawPayload.datesNote as { en: string }).en,
                    ur: (rawPayload.datesNote as { ur: string }).ur,
                  }
                : undefined,
            verifiedBy:
              typeof rawPayload.verifiedBy === 'string'
                ? rawPayload.verifiedBy
                : undefined,
          };

          if (!BUNDLED_IDS.has(id)) {
            const parsedDiscovered = GovernmentSchemeSchema.safeParse({
              ...rawPayload,
              id,
              status: patches[id].status,
              expiresAt: patches[id].expiresAt,
              autoDiscovered: true,
            });
            if (parsedDiscovered.success) {
              discoveredSchemes.push(parsedDiscovered.data);
            }
          }
        }

        const state: PersistedSchemesState = {
          lastAutoCheckAt: latestCheck,
          patches,
          discoveredSchemes,
        };
        globalThis.__zarkhezSchemesState = state;
        return { state, source: 'supabase' };
      }
    } catch {
      // Table may not exist yet or network error; fall through cleanly
    }
  }

  // 2. Try Upstash Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get<PersistedSchemesState>(REDIS_STATE_KEY);
      const parsed = PersistedStateSchema.safeParse(raw);
      if (parsed.success) {
        globalThis.__zarkhezSchemesState = parsed.data;
        return { state: parsed.data, source: 'redis' };
      }
    } catch {
      // Fall through cleanly
    }
  }

  // 3. Try warm global memory / local /tmp fallback
  if (globalThis.__zarkhezSchemesState) {
    return { state: globalThis.__zarkhezSchemesState, source: 'tmp' };
  }

  try {
    const fileText = await fs.readFile(TMP_STATE_FILE, 'utf8');
    const parsedJson = JSON.parse(fileText) as unknown;
    const parsed = PersistedStateSchema.safeParse(parsedJson);
    if (parsed.success) {
      globalThis.__zarkhezSchemesState = parsed.data;
      return { state: parsed.data, source: 'tmp' };
    }
  } catch {
    // Seed from bundled schemes below
  }

  return {
    state: { lastAutoCheckAt: null, patches: {}, discoveredSchemes: [] },
    source: 'bundled',
  };
}

function mergeCatalogWithPatches(
  state: PersistedSchemesState,
  todayIso: string
): GovernmentSchemeItem[] {
  const seenIds = new Set<string>();
  const combinedList: GovernmentSchemeItem[] = [];

  // Place verified auto-discovered latest schemes first so new government launches stand out
  for (const rawDiscovered of state.discoveredSchemes ?? []) {
    if (seenIds.has(rawDiscovered.id) || BUNDLED_IDS.has(rawDiscovered.id)) {
      continue;
    }
    const patch = state.patches[rawDiscovered.id];
    const mergedItem: GovernmentSchemeItem = patch
      ? {
          ...rawDiscovered,
          status: patch.status,
          expiresAt: patch.expiresAt,
          lastVerifiedAt: patch.lastVerifiedAt || rawDiscovered.lastVerifiedAt,
          autoCheckedAt: patch.autoCheckedAt ?? rawDiscovered.autoCheckedAt,
          expiredAutoDetected:
            patch.expiredAutoDetected ?? rawDiscovered.expiredAutoDetected,
          portalReachable:
            patch.portalReachable ?? rawDiscovered.portalReachable,
          datesNote: patch.datesNote
            ? { ...patch.datesNote }
            : { ...rawDiscovered.datesNote },
          verifiedBy: patch.verifiedBy || rawDiscovered.verifiedBy,
          autoDiscovered: true,
        }
      : { ...rawDiscovered, autoDiscovered: true };

    seenIds.add(mergedItem.id);
    combinedList.push(applySchemeExpiryRules(mergedItem, todayIso));
  }

  for (const bundled of BUNDLED_SCHEMES) {
    if (seenIds.has(bundled.id)) continue;
    const patch = state.patches[bundled.id];
    const mergedItem: GovernmentSchemeItem = patch
      ? {
          ...bundled,
          status: patch.status,
          expiresAt: patch.expiresAt,
          lastVerifiedAt: patch.lastVerifiedAt || bundled.lastVerifiedAt,
          autoCheckedAt: patch.autoCheckedAt ?? bundled.autoCheckedAt,
          expiredAutoDetected:
            patch.expiredAutoDetected !== undefined
              ? patch.expiredAutoDetected
              : bundled.expiredAutoDetected,
          portalReachable:
            patch.portalReachable !== undefined
              ? patch.portalReachable
              : bundled.portalReachable,
          datesNote: patch.datesNote ? { ...patch.datesNote } : { ...bundled.datesNote },
          verifiedBy: patch.verifiedBy || bundled.verifiedBy,
        }
      : { ...bundled, datesNote: { ...bundled.datesNote } };

    seenIds.add(mergedItem.id);
    combinedList.push(applySchemeExpiryRules(mergedItem, todayIso));
  }

  return sortSchemesActiveFirst(combinedList);
}

async function persistSchemesState(
  schemes: GovernmentSchemeItem[],
  lastAutoCheckAt: string | null
): Promise<SchemesStorageSource> {
  const patches: Record<string, PersistedSchemePatch> = {};
  const discoveredSchemes: GovernmentSchemeItem[] = [];

  for (const s of schemes) {
    patches[s.id] = {
      id: s.id,
      status: s.status,
      expiresAt: s.expiresAt,
      lastVerifiedAt: s.lastVerifiedAt,
      autoCheckedAt: s.autoCheckedAt,
      expiredAutoDetected: s.expiredAutoDetected,
      portalReachable: s.portalReachable,
      datesNote: s.datesNote,
      verifiedBy: s.verifiedBy,
    };
    if (!BUNDLED_IDS.has(s.id) && s.autoDiscovered) {
      discoveredSchemes.push(s);
    }
  }

  const trimmedDiscovered = discoveredSchemes.slice(0, MAX_DISCOVERED_SCHEMES);
  const state: PersistedSchemesState = {
    lastAutoCheckAt,
    patches,
    discoveredSchemes: trimmedDiscovered,
  };
  globalThis.__zarkhezSchemesState = state;

  let persistedSource: SchemesStorageSource = 'tmp';

  // 1. Persist to Supabase `public.schemes` if available
  const supabase = getSupabaseServiceClient();
  if (supabase) {
    try {
      const rows = schemes.map((s) => ({
        id: s.id,
        status: s.status,
        expires_at: isValidIsoDateString(s.expiresAt) ? s.expiresAt : null,
        last_verified_at: s.lastVerifiedAt,
        auto_checked_at: s.autoCheckedAt ?? lastAutoCheckAt,
        payload: s,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from('schemes').upsert(rows, { onConflict: 'id' });
      if (!error) {
        persistedSource = 'supabase';
      }
    } catch {
      // Table not yet created; continue to Redis / tmp
    }
  }

  // 2. Also sync Upstash Redis if configured
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(REDIS_STATE_KEY, state);
      if (persistedSource === 'tmp') {
        persistedSource = 'redis';
      }
    } catch {
      // Non-fatal
    }
  }

  // 3. Always mirror to /tmp when filesystem allows
  try {
    await fs.writeFile(TMP_STATE_FILE, JSON.stringify(state), 'utf8');
  } catch {
    // Read-only FS edge case safely ignored
  }

  return persistedSource;
}

export function isSchemesStateStale(
  lastAutoCheckAt: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!lastAutoCheckAt) return true;
  const parsed = Date.parse(lastAutoCheckAt);
  if (Number.isNaN(parsed)) return true;
  return nowMs - parsed >= SCHEMES_AUTO_REFRESH_TTL_MS;
}

/**
 * Loads current server schemes state and immediately applies Pakistan-timezone auto-expiry checks.
 */
export async function loadSchemesCatalogServer(): Promise<SchemesCatalogResponse> {
  const { state, source } = await readRawPersistedState();
  const todayIso = getTodayPakistanIsoDate();
  const schemes = mergeCatalogWithPatches(state, todayIso);

  const changed = schemes.some((s) => {
    const prev = state.patches[s.id];
    return Boolean(s.expiredAutoDetected && (!prev || prev.status !== 'expired'));
  });
  if (changed && Object.keys(state.patches).length > 0) {
    void persistSchemesState(schemes, state.lastAutoCheckAt).catch(() => undefined);
  }

  return {
    schemes,
    lastAutoCheckAt: state.lastAutoCheckAt,
    source,
  };
}

interface PortalProbeResult {
  reachable: boolean;
  dnsFailed: boolean;
}

/**
 * Checks whether official `.gov.pk`/`.gos.pk`/`.com.pk` portals respond or fail DNS lookup.
 */
async function probeOfficialPortals(
  urls: string[]
): Promise<Map<string, PortalProbeResult>> {
  const results = new Map<string, PortalProbeResult>();
  const uniqueUrls = Array.from(new Set(urls)).filter(isOfficialPakistanPortalUrl);

  await Promise.allSettled(
    uniqueUrls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(4000),
          headers: {
            'User-Agent': 'ZarkhezSchemesMonitor/1.0 (+https://zarkhez.pk)',
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          },
        });
        const finalUrlValid = res.url ? isOfficialPakistanPortalUrl(res.url) : true;
        results.set(url, {
          reachable: res.ok && finalUrlValid,
          dnsFailed: !finalUrlValid,
        });
      } catch (err) {
        const code =
          err &&
          typeof err === 'object' &&
          'cause' in err &&
          err.cause &&
          typeof err.cause === 'object' &&
          'code' in err.cause
            ? String((err.cause as { code?: unknown }).code || '')
            : '';
        results.set(url, {
          reachable: false,
          dnsFailed: code === 'ENOTFOUND' || code === 'EAI_AGAIN',
        });
      }
    })
  );

  return results;
}

const OFFICIAL_DOMAIN_TEXT_RX = /\.(?:gov|gos|gop|gokp|gob)\.pk\b|ztbl\.com\.pk\b/i;

function hasOfficialGroundedChunk(
  chunks: Array<{ web?: { uri?: string; title?: string } }>
): boolean {
  return chunks.some((chunk) => {
    const uri = chunk.web?.uri || '';
    const title = chunk.web?.title || '';
    return (
      (uri && isOfficialPakistanPortalUrl(uri)) ||
      OFFICIAL_DOMAIN_TEXT_RX.test(uri) ||
      OFFICIAL_DOMAIN_TEXT_RX.test(title)
    );
  });
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DiscoveredCandidateSchema = z.object({
  id: z.string().min(3).max(80),
  titleEn: z.string().min(4).max(160),
  titleUr: z.string().min(4).max(200),
  province: z.enum([
    'Punjab',
    'Sindh',
    'Khyber Pakhtunkhwa',
    'Balochistan',
    'National',
  ]),
  department: z.string().min(3).max(160),
  officialPortal: z.string(),
  helpline: z.string().max(100).optional(),
  status: z.enum(['ongoing', 'verify_on_portal']),
  expiresAt: z.string().nullable().optional(),
  datesNoteEn: z.string().min(4).max(280),
  datesNoteUr: z.string().min(4).max(340),
  summaryEn: z.string().min(10).max(480),
  summaryUr: z.string().min(10).max(580),
  eligibilityEn: z.array(z.string().min(3).max(180)).min(1).max(6),
  eligibilityUr: z.array(z.string().min(3).max(220)).min(1).max(6),
  documentsEn: z.array(z.string().min(2).max(160)).min(1).max(6).optional(),
  documentsUr: z.array(z.string().min(2).max(200)).min(1).max(6).optional(),
  stepsEn: z.array(z.string().min(4).max(200)).min(1).max(6).optional(),
  stepsUr: z.array(z.string().min(4).max(240)).min(1).max(6).optional(),
});

const GeminiSchemeUpdatesSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().min(1),
      status: z.enum(['ongoing', 'verify_on_portal', 'expired']),
      expiresAt: z.string().nullable().optional(),
      evidenceUrl: z.string().nullable().optional(),
      datesNoteEn: z.string().max(260).nullable().optional(),
      datesNoteUr: z.string().max(260).nullable().optional(),
    })
  ),
  discoveredSchemes: z.array(DiscoveredCandidateSchema).optional(),
});

type GeminiSchemeUpdateItem = z.infer<typeof GeminiSchemeUpdatesSchema>['updates'][number];
type DiscoveredCandidate = z.infer<typeof DiscoveredCandidateSchema>;

/**
 * Validates and normalizes an automatically discovered scheme against existing catalog IDs/titles
 * and strict Pakistani official portal allowlist rules.
 */
export function validateDiscoveredSchemeCandidate(
  rawCandidate: unknown,
  existingSchemes: GovernmentSchemeItem[],
  todayIso: string = getTodayPakistanIsoDate()
): GovernmentSchemeItem | null {
  const parsed = DiscoveredCandidateSchema.safeParse(rawCandidate);
  if (!parsed.success) return null;

  const candidate: DiscoveredCandidate = parsed.data;
  if (!isOfficialPakistanPortalUrl(candidate.officialPortal)) {
    return null;
  }

  const slug = candidate.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

  if (slug.length < 4) return null;

  const existingIds = new Set(existingSchemes.map((s) => s.id));
  const existingTitles = new Set(
    existingSchemes.map((s) => normalizeTitleKey(s.title.en))
  );

  if (
    existingIds.has(slug) ||
    existingTitles.has(normalizeTitleKey(candidate.titleEn))
  ) {
    return null;
  }

  const validExpiry = isValidIsoDateString(candidate.expiresAt)
    ? candidate.expiresAt
    : undefined;

  // Never add newly discovered schemes that already expired in the past
  if (validExpiry && validExpiry < todayIso) {
    return null;
  }

  const normalized: GovernmentSchemeItem = {
    id: slug,
    title: {
      en: candidate.titleEn.trim(),
      ur: candidate.titleUr.trim(),
    },
    province: candidate.province,
    department: candidate.department.trim(),
    officialPortal: candidate.officialPortal.trim(),
    helpline: candidate.helpline?.trim() || 'Official Portal / District Agriculture Office',
    status: candidate.status,
    lastVerifiedAt: todayIso,
    expiresAt: validExpiry,
    autoCheckedAt: new Date().toISOString(),
    autoDiscovered: true,
    datesNote: {
      en: candidate.datesNoteEn.trim(),
      ur: candidate.datesNoteUr.trim(),
    },
    summary: {
      en: candidate.summaryEn.trim(),
      ur: candidate.summaryUr.trim(),
    },
    eligibility: {
      en: candidate.eligibilityEn.map((s) => s.trim()),
      ur: candidate.eligibilityUr.map((s) => s.trim()),
    },
    documents: {
      en:
        candidate.documentsEn && candidate.documentsEn.length > 0
          ? candidate.documentsEn.map((s) => s.trim())
          : ['Valid CNIC (Nadra)', 'Land Ownership / Tenancy Proof'],
      ur:
        candidate.documentsUr && candidate.documentsUr.length > 0
          ? candidate.documentsUr.map((s) => s.trim())
          : ['اصل شناختی کارڈ', 'اراضی ریکارڈ / کاشتکاری ثبوت'],
    },
    steps: {
      en:
        candidate.stepsEn && candidate.stepsEn.length > 0
          ? candidate.stepsEn.map((s) => s.trim())
          : [`Check full registration steps on ${candidate.officialPortal}`],
      ur:
        candidate.stepsUr && candidate.stepsUr.length > 0
          ? candidate.stepsUr.map((s) => s.trim())
          : [`مکمل طریقہ کار آفیشل پورٹل ${candidate.officialPortal} پر دیکھیں۔`],
    },
    verifiedBy: 'Auto-Discovered from Official Portal',
  };

  return GovernmentSchemeSchema.safeParse(normalized).success ? normalized : null;
}

async function verifyAndDiscoverSchemesViaGemini(
  schemes: GovernmentSchemeItem[],
  todayIso: string
): Promise<{
  updatesById: Map<string, GeminiSchemeUpdateItem>;
  discoveredCandidates: GovernmentSchemeItem[];
  groundedOfficialHostsVerified: boolean;
}> {
  const updatesById = new Map<string, GeminiSchemeUpdateItem>();
  const discoveredCandidates: GovernmentSchemeItem[] = [];
  if (!hasAnyConfiguredGeminiAccount()) {
    return {
      updatesById,
      discoveredCandidates,
      groundedOfficialHostsVerified: false,
    };
  }

  const model = (process.env.GEMINI_MODEL_FAST || 'gemini-2.5-flash').trim();
  const compactCatalog = schemes.map((s) => ({
    id: s.id,
    title: s.title.en,
    province: s.province,
    officialPortal: s.officialPortal,
    currentStatus: s.status,
    currentExpiresAt: s.expiresAt ?? null,
  }));

  const prompt = [
    `Today's date in Pakistan (PKT) is ${todayIso}.`,
    `Task 1 — Verify current official application status and closing deadline for these existing Pakistani farmer schemes ONLY from official .gov.pk, .gos.pk, .gop.pk, .gokp.pk, .gob.pk, or ztbl.com.pk announcements:`,
    JSON.stringify(compactCatalog),
    `Task 2 — Search official Pakistani government agriculture & bank portals (punjab.gov.pk, agripunjab.gov.pk, sindh.gov.pk, gos.pk, kp.gov.pk, balochistan.gov.pk, mnfsr.gov.pk, ztbl.com.pk) for ANY NEW OR LATEST active official Pakistani farmer schemes/subsidies (Kissan Card, Solar, Tractor, Green Financing, Livestock, Seed/Fertilizer subsidy) that are NOT in the list above.`,
    `STRICT ANTI-HALLUCINATION RULES:`,
    `- NEVER invent or guess an expiry date. Set expiresAt to "YYYY-MM-DD" ONLY if officially stated; otherwise null.`,
    `- Set existing status to "expired" ONLY if officially announced closed OR official deadline < ${todayIso}.`,
    `- Only include discoveredSchemes that are CURRENTLY ACTIVE (ongoing or verify_on_portal), backed by real official HTTPS portals (.gov.pk, .gos.pk, .gop.pk, .gokp.pk, .gob.pk, or ztbl.com.pk).`,
    `- Never invent phone helplines; use verified helpline or "Official Portal / District Agriculture Office".`,
    `- Return ONLY raw JSON matching this schema:`,
    `{"updates":[{"id":"...","status":"ongoing|verify_on_portal|expired","expiresAt":"YYYY-MM-DD or null","evidenceUrl":"https://... or null","datesNoteEn":"...","datesNoteUr":"..."}],"discoveredSchemes":[{"id":"snake_case_id","titleEn":"...","titleUr":"...","province":"Punjab|Sindh|Khyber Pakhtunkhwa|Balochistan|National","department":"...","officialPortal":"https://...gov.pk/...","helpline":"...","status":"ongoing|verify_on_portal","expiresAt":null,"datesNoteEn":"...","datesNoteUr":"...","summaryEn":"...","summaryUr":"...","eligibilityEn":["..."],"eligibilityUr":["..."],"documentsEn":["..."],"documentsUr":["..."],"stepsEn":["..."],"stepsUr":["..."]}]}`,
  ].join('\n');

  try {
    const failoverRes = await executeGeminiWithFailover({
      models: [model],
      timeoutMs: 5500,
      overallDeadlineMs: 12_000,
      buildRequestBody: () => ({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // google_search cannot be combined with responseMimeType: application/json
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    });

    if (!failoverRes.ok) {
      return {
        updatesById,
        discoveredCandidates,
        groundedOfficialHostsVerified: false,
      };
    }

    const payload = failoverRes.data as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      }>;
    };

    const candidate = payload.candidates?.[0];
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const groundedVerified = hasOfficialGroundedChunk(chunks);

    const rawText = (candidate?.content?.parts ?? [])
      .map((p) => p.text || '')
      .join('\n')
      .trim();

    if (!rawText) {
      return {
        updatesById,
        discoveredCandidates,
        groundedOfficialHostsVerified: false,
      };
    }

    const extracted = extractAndParseJson(rawText);
    if (!extracted.ok) {
      return {
        updatesById,
        discoveredCandidates,
        groundedOfficialHostsVerified: false,
      };
    }

    const validated = GeminiSchemeUpdatesSchema.safeParse(extracted.data);
    if (!validated.success) {
      return {
        updatesById,
        discoveredCandidates,
        groundedOfficialHostsVerified: false,
      };
    }

    for (const item of validated.data.updates) {
      const urlOk =
        typeof item.evidenceUrl === 'string' && isOfficialPakistanPortalUrl(item.evidenceUrl);
      if (urlOk) {
        updatesById.set(item.id, item);
      }
    }

    if (groundedVerified && Array.isArray(validated.data.discoveredSchemes)) {
      const runningList = [...schemes];
      for (const rawDisc of validated.data.discoveredSchemes) {
        const cleanDisc = validateDiscoveredSchemeCandidate(
          rawDisc,
          runningList,
          todayIso
        );
        if (cleanDisc) {
          discoveredCandidates.push(cleanDisc);
          runningList.push(cleanDisc);
        }
      }
    }

    return {
      updatesById,
      discoveredCandidates,
      groundedOfficialHostsVerified: groundedVerified,
    };
  } catch (err) {
    const safeErr = redactSecrets(err instanceof Error ? err.message : String(err));
    if (safeErr) {
      console.warn('[schemes-refresh] grounded check skipped:', safeErr.slice(0, 140));
    }
    return {
      updatesById,
      discoveredCandidates,
      groundedOfficialHostsVerified: false,
    };
  }
}

/**
 * Automatically updates existing schemes, discovers latest official government schemes,
 * and expires schemes whose official closing date has passed in Pakistan time.
 */
export async function refreshSchemesFromPortals(options?: {
  force?: boolean;
}): Promise<RefreshSchemesResult> {
  const force = Boolean(options?.force);
  const current = await loadSchemesCatalogServer();

  if (!force && !isSchemesStateStale(current.lastAutoCheckAt)) {
    return {
      ...current,
      checkedCount: 0,
      expiredCount: current.schemes.filter((s) => s.status === 'expired').length,
      discoveredCount: 0,
    };
  }

  if (globalThis.__zarkhezSchemesRefreshPromise) {
    return globalThis.__zarkhezSchemesRefreshPromise;
  }

  const runRefresh = async (): Promise<RefreshSchemesResult> => {
    try {
      const todayIso = getTodayPakistanIsoDate();
      const nowIso = new Date().toISOString();
      const latest = await loadSchemesCatalogServer();

      const [reachabilityMap, groundedResult] = await Promise.all([
        probeOfficialPortals(latest.schemes.map((s) => s.officialPortal)),
        verifyAndDiscoverSchemesViaGemini(latest.schemes, todayIso),
      ]);

      // Verify any newly discovered portals do not fail DNS lookup
      const verifiedNewSchemes: GovernmentSchemeItem[] = [];
      if (groundedResult.discoveredCandidates.length > 0) {
        const discProbes = await probeOfficialPortals(
          groundedResult.discoveredCandidates.map((s) => s.officialPortal)
        );
        for (const cand of groundedResult.discoveredCandidates) {
          const probe = discProbes.get(cand.officialPortal);
          if (probe?.dnsFailed) {
            continue;
          }
          verifiedNewSchemes.push(
            applySchemeExpiryRules(
              {
                ...cand,
                autoCheckedAt: nowIso,
                portalReachable: probe?.reachable,
              },
              todayIso
            )
          );
        }
      }

      const updatedExisting = latest.schemes.map((scheme) => {
        const portalProbe = reachabilityMap.get(scheme.officialPortal);
        const aiUpdate = groundedResult.updatesById.get(scheme.id);

        let nextStatus = scheme.status;
        let nextExpiresAt = scheme.expiresAt;
        const nextDatesNote = { ...scheme.datesNote };
        let nextVerifiedBy = scheme.verifiedBy;
        let nextLastVerified = scheme.lastVerifiedAt;

        if (portalProbe?.reachable) {
          nextLastVerified = todayIso;
        }

        if (aiUpdate && groundedResult.groundedOfficialHostsVerified) {
          const validNewExpiry = isValidIsoDateString(aiUpdate.expiresAt)
            ? aiUpdate.expiresAt
            : undefined;

          if (validNewExpiry) {
            nextExpiresAt = validNewExpiry;
          }

          if (aiUpdate.status === 'expired') {
            if (validNewExpiry && validNewExpiry < todayIso) {
              nextStatus = 'expired';
            } else if (
              aiUpdate.datesNoteEn &&
              /\b(?:closed|expired|last date passed|ended)\b/i.test(aiUpdate.datesNoteEn)
            ) {
              nextStatus = 'expired';
            }
          } else if (aiUpdate.status === 'ongoing' && (!validNewExpiry || validNewExpiry >= todayIso)) {
            nextStatus = 'ongoing';
          } else if (aiUpdate.status === 'verify_on_portal') {
            nextStatus = 'verify_on_portal';
          }

          if (aiUpdate.datesNoteEn && aiUpdate.datesNoteEn.trim().length > 8) {
            nextDatesNote.en = aiUpdate.datesNoteEn.trim();
          }
          if (aiUpdate.datesNoteUr && aiUpdate.datesNoteUr.trim().length > 8) {
            nextDatesNote.ur = aiUpdate.datesNoteUr.trim();
          }

          nextLastVerified = todayIso;
          nextVerifiedBy = scheme.autoDiscovered
            ? 'Auto-Discovered from Official Portal'
            : 'Auto-Verified Official Portal Check';
        }

        return applySchemeExpiryRules(
          {
            ...scheme,
            status: nextStatus,
            expiresAt: nextExpiresAt,
            autoCheckedAt: nowIso,
            portalReachable: portalProbe?.reachable ?? scheme.portalReachable,
            lastVerifiedAt: nextLastVerified,
            datesNote: nextDatesNote,
            verifiedBy: nextVerifiedBy,
          },
          todayIso
        );
      });

      const mergedAll = [...verifiedNewSchemes, ...updatedExisting];
      const sorted = sortSchemesActiveFirst(mergedAll);
      const source = await persistSchemesState(sorted, nowIso);
      const expiredCount = sorted.filter((s) => s.status === 'expired').length;

      return {
        schemes: sorted,
        lastAutoCheckAt: nowIso,
        source,
        checkedCount: sorted.length,
        expiredCount,
        discoveredCount: verifiedNewSchemes.length,
      };
    } finally {
      globalThis.__zarkhezSchemesRefreshPromise = undefined;
    }
  };

  globalThis.__zarkhezSchemesRefreshPromise = runRefresh();
  return globalThis.__zarkhezSchemesRefreshPromise;
}
