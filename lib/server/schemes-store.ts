import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import rawSchemes from '@/data/schemes.json';
import { redactSecrets } from '@/lib/error-sanitizer';
import { extractAndParseJson } from '@/lib/json-extractor';
import {
  applySchemeExpiryRules,
  getTodayPakistanIsoDate,
  isOfficialPakistanPortalUrl,
  isValidIsoDateString,
  sortSchemesActiveFirst,
  type AdminSchemeUpdatePayload,
  type GovernmentSchemeItem,
  type SchemesCatalogResponse,
  type SchemesStorageSource,
} from '@/lib/schemes';

const BUNDLED_SCHEMES = rawSchemes as GovernmentSchemeItem[];
const REDIS_STATE_KEY = 'zarkhez:schemes_state_v1';
const TMP_STATE_FILE = path.join(os.tmpdir(), 'zarkhez-schemes-state.json');

/** Re-check official portals automatically every 12 hours when traffic hits `/api/schemes` */
export const SCHEMES_AUTO_REFRESH_TTL_MS = 12 * 60 * 60 * 1000;

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
}

export interface RefreshSchemesResult extends SchemesCatalogResponse {
  checkedCount: number;
  expiredCount: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __zarkhezSchemesState: PersistedSchemesState | undefined;
  // eslint-disable-next-line no-var
  var __zarkhezSchemesRefreshPromise: Promise<RefreshSchemesResult> | undefined;
}

function getSupabaseAdminClient() {
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
});

async function readRawPersistedState(): Promise<{
  state: PersistedSchemesState;
  source: SchemesStorageSource;
}> {
  // 1. Try Supabase public.schemes table if configured and migrated
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('schemes')
        .select('id, status, expires_at, last_verified_at, auto_checked_at, payload');

      if (!error && Array.isArray(data) && data.length > 0) {
        const patches: Record<string, PersistedSchemePatch> = {};
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
        }

        const state: PersistedSchemesState = {
          lastAutoCheckAt: latestCheck,
          patches,
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
    state: { lastAutoCheckAt: null, patches: {} },
    source: 'bundled',
  };
}

function mergeCatalogWithPatches(
  state: PersistedSchemesState,
  todayIso: string
): GovernmentSchemeItem[] {
  const merged = BUNDLED_SCHEMES.map((bundled) => {
    const patch = state.patches[bundled.id];
    const combined: GovernmentSchemeItem = patch
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

    return applySchemeExpiryRules(combined, todayIso);
  });

  return sortSchemesActiveFirst(merged);
}

async function persistSchemesState(
  schemes: GovernmentSchemeItem[],
  lastAutoCheckAt: string | null
): Promise<SchemesStorageSource> {
  const patches: Record<string, PersistedSchemePatch> = {};
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
  }

  const state: PersistedSchemesState = { lastAutoCheckAt, patches };
  globalThis.__zarkhezSchemesState = state;

  let persistedSource: SchemesStorageSource = 'tmp';

  // 1. Persist to Supabase `public.schemes` if available
  const supabase = getSupabaseAdminClient();
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

  // 2. Also sync Upstash Redis if configured (fast read cache or primary if no Supabase table)
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

  // If any scheme auto-expired just now across midnight PKT, persist the updated expired status lazily
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

/**
 * Checks whether an official `.gov.pk`/`.gos.pk`/`.com.pk` portal responds cleanly.
 * Never invents deadlines or overrides status merely because a portal timed out or blocked bots.
 */
async function probeOfficialPortals(
  urls: string[]
): Promise<Map<string, { reachable: boolean }>> {
  const results = new Map<string, { reachable: boolean }>();
  const uniqueUrls = Array.from(new Set(urls)).filter(isOfficialPakistanPortalUrl);

  await Promise.allSettled(
    uniqueUrls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(4200),
          headers: {
            'User-Agent': 'ZarkhezSchemesMonitor/1.0 (+https://zarkhez.pk)',
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          },
        });
        const finalUrlValid = res.url ? isOfficialPakistanPortalUrl(res.url) : true;
        results.set(url, { reachable: res.ok && finalUrlValid });
      } catch {
        results.set(url, { reachable: false });
      }
    })
  );

  return results;
}

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
});

type GeminiSchemeUpdateItem = z.infer<typeof GeminiSchemeUpdatesSchema>['updates'][number];

async function verifySchemesViaGroundedGemini(
  schemes: GovernmentSchemeItem[],
  todayIso: string
): Promise<{
  updatesById: Map<string, GeminiSchemeUpdateItem>;
  groundedOfficialHostsVerified: boolean;
}> {
  const updatesById = new Map<string, GeminiSchemeUpdateItem>();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return { updatesById, groundedOfficialHostsVerified: false };
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
    `Verify the current official application status and official closing deadline (if published) for these Pakistani government farmer schemes ONLY from official .gov.pk, .gos.pk, .gop.pk, .gokp.pk, .gob.pk, or ztbl.com.pk announcements:`,
    JSON.stringify(compactCatalog),
    `STRICT RULES:`,
    `- NEVER invent or guess an expiry date. Set expiresAt strictly to "YYYY-MM-DD" ONLY if an official government notice states an explicit closing date; otherwise set expiresAt to null.`,
    `- Set status to "expired" ONLY if an official portal announcement explicitly states applications/current phase closed OR the official closing deadline is strictly before ${todayIso}.`,
    `- Set status to "ongoing" ONLY if currently open for farmer registration on the official portal.`,
    `- Otherwise set status to "verify_on_portal".`,
    `- Only include evidenceUrl if it starts with https:// and belongs to the official government/ZTBL domain.`,
    `- Return ONLY raw JSON with shape: {"updates":[{"id":"...","status":"ongoing|verify_on_portal|expired","expiresAt":"YYYY-MM-DD or null","evidenceUrl":"https://... or null","datesNoteEn":"short factual 1-line note or null","datesNoteUr":"short Urdu note or null"}]}`,
  ].join('\n');

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(5500),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // Note: google_search cannot be combined with responseMimeType: application/json
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    });

    if (!res.ok) {
      return { updatesById, groundedOfficialHostsVerified: false };
    }

    const payload = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string } }>;
        };
      }>;
    };

    const candidate = payload.candidates?.[0];
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    const groundedOfficialUrls = chunks
      .map((c) => c.web?.uri)
      .filter((u): u is string => Boolean(u && isOfficialPakistanPortalUrl(u)));

    const rawText = (candidate?.content?.parts ?? [])
      .map((p) => p.text || '')
      .join('\n')
      .trim();

    if (!rawText) {
      return { updatesById, groundedOfficialHostsVerified: false };
    }

    const extracted = extractAndParseJson(rawText);
    if (!extracted.ok) {
      return { updatesById, groundedOfficialHostsVerified: false };
    }

    const validated = GeminiSchemeUpdatesSchema.safeParse(extracted.data);
    if (!validated.success) {
      return { updatesById, groundedOfficialHostsVerified: false };
    }

    const groundedVerified = groundedOfficialUrls.length > 0;
    for (const item of validated.data.updates) {
      const urlOk =
        typeof item.evidenceUrl === 'string' && isOfficialPakistanPortalUrl(item.evidenceUrl);
      if (urlOk) {
        updatesById.set(item.id, item);
      }
    }

    return {
      updatesById,
      groundedOfficialHostsVerified: groundedVerified,
    };
  } catch (err) {
    // Keep server logs redacted without exposing credentials
    const safeErr = redactSecrets(err instanceof Error ? err.message : String(err));
    if (safeErr) {
      console.warn('[schemes-refresh] grounded check skipped:', safeErr.slice(0, 140));
    }
    return { updatesById, groundedOfficialHostsVerified: false };
  }
}

/**
 * Automatically checks official portals + applies deterministic expiry rules.
 * Enforces 12h cooldown unless `force: true` (Cron or Admin trigger) and shares one in-flight lock.
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

      // Run direct portal reachability checks and grounded official verification in parallel
      const [reachabilityMap, groundedResult] = await Promise.all([
        probeOfficialPortals(latest.schemes.map((s) => s.officialPortal)),
        verifySchemesViaGroundedGemini(latest.schemes, todayIso),
      ]);

      const updatedSchemes = latest.schemes.map((scheme) => {
        const portalProbe = reachabilityMap.get(scheme.officialPortal);
        const aiUpdate = groundedResult.updatesById.get(scheme.id);

        let nextStatus = scheme.status;
        let nextExpiresAt = scheme.expiresAt;
        let nextDatesNote = { ...scheme.datesNote };
        let nextVerifiedBy = scheme.verifiedBy;
        let nextLastVerified = scheme.lastVerifiedAt;

        if (portalProbe?.reachable) {
          nextLastVerified = todayIso;
        }

        // Only apply AI grounded update if an official Pakistani gov/ZTBL source URL backed it
        if (aiUpdate && groundedResult.groundedOfficialHostsVerified) {
          const validNewExpiry = isValidIsoDateString(aiUpdate.expiresAt)
            ? aiUpdate.expiresAt
            : undefined;

          if (validNewExpiry) {
            nextExpiresAt = validNewExpiry;
          }

          // Respect explicit admin manual closures; only advance verified status cleanly
          if (scheme.status === 'expired' && !scheme.expiredAutoDetected) {
            nextStatus = 'expired';
          } else if (aiUpdate.status === 'expired') {
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
          } else if (aiUpdate.status === 'verify_on_portal' && !scheme.expiredAutoDetected) {
            nextStatus = 'verify_on_portal';
          }

          if (aiUpdate.datesNoteEn && aiUpdate.datesNoteEn.trim().length > 8) {
            nextDatesNote.en = aiUpdate.datesNoteEn.trim();
          }
          if (aiUpdate.datesNoteUr && aiUpdate.datesNoteUr.trim().length > 8) {
            nextDatesNote.ur = aiUpdate.datesNoteUr.trim();
          }

          nextLastVerified = todayIso;
          nextVerifiedBy = 'Auto-Verified Official Portal Check';
        }

        const evaluated = applySchemeExpiryRules(
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

        return evaluated;
      });

      const sorted = sortSchemesActiveFirst(updatedSchemes);
      const source = await persistSchemesState(sorted, nowIso);
      const expiredCount = sorted.filter((s) => s.status === 'expired').length;

      return {
        schemes: sorted,
        lastAutoCheckAt: nowIso,
        source,
        checkedCount: sorted.length,
        expiredCount,
      };
    } finally {
      globalThis.__zarkhezSchemesRefreshPromise = undefined;
    }
  };

  globalThis.__zarkhezSchemesRefreshPromise = runRefresh();
  return globalThis.__zarkhezSchemesRefreshPromise;
}

/**
 * Persists an explicit administrator update (`status`, `expiresAt`, `datesNote`, `verifiedBy`).
 */
export async function adminUpdateSchemeServer(
  patch: AdminSchemeUpdatePayload
): Promise<SchemesCatalogResponse & { updatedScheme: GovernmentSchemeItem }> {
  const current = await loadSchemesCatalogServer();
  const todayIso = getTodayPakistanIsoDate();

  const existing = current.schemes.find((s) => s.id === patch.id);
  if (!existing) {
    throw new Error(`Unknown scheme id: ${patch.id}`);
  }

  let normalizedExpiry: string | undefined = existing.expiresAt;
  if (patch.expiresAt === null || patch.expiresAt === '') {
    normalizedExpiry = undefined;
  } else if (typeof patch.expiresAt === 'string') {
    if (!isValidIsoDateString(patch.expiresAt)) {
      throw new Error('Invalid expiry date format. Use YYYY-MM-DD.');
    }
    normalizedExpiry = patch.expiresAt;
  }

  const nextDatesNote =
    patch.datesNote &&
    typeof patch.datesNote.en === 'string' &&
    typeof patch.datesNote.ur === 'string'
      ? {
          en: patch.datesNote.en.trim() || existing.datesNote.en,
          ur: patch.datesNote.ur.trim() || existing.datesNote.ur,
        }
      : { ...existing.datesNote };

  const updatedCandidate: GovernmentSchemeItem = {
    ...existing,
    status: patch.status,
    expiresAt: normalizedExpiry,
    expiredAutoDetected: false,
    lastVerifiedAt: todayIso,
    verifiedBy: (patch.verifiedBy || 'Admin Portal Operator').trim(),
    datesNote: nextDatesNote,
  };

  const evaluatedTarget = applySchemeExpiryRules(updatedCandidate, todayIso);
  const nextList = sortSchemesActiveFirst(
    current.schemes.map((s) => (s.id === patch.id ? evaluatedTarget : s))
  );

  const source = await persistSchemesState(nextList, current.lastAutoCheckAt);

  return {
    schemes: nextList,
    lastAutoCheckAt: current.lastAutoCheckAt,
    source,
    updatedScheme: evaluatedTarget,
  };
}
