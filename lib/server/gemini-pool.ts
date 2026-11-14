import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '@/lib/error-sanitizer';

export type ProjectHealthStatus =
  | 'active'
  | 'rate_limited'
  | 'auth_failed'
  | 'unavailable'
  | 'recovering'
  | 'disabled';

export type QuotaLimitKind =
  | 'none'
  | 'rpm_tpm_temporary'
  | 'daily_rpd_exhausted'
  | 'billing_or_spending_limit'
  | 'auth_rejected'
  | 'service_unavailable';

export interface GeminiAccountConfig {
  slot: 1 | 2 | 3 | 4 | 5;
  id: string;
  apiKey: string;
  keyFingerprint: string;
  maskedKey: string;
  configuredProjectId?: string;
  effectiveProjectId: string;
  projectVerified: boolean;
  enabled: boolean;
  isLegacyFallback?: boolean;
}

export interface ProjectRuntimeState {
  effectiveProjectId: string;
  configuredProjectId?: string;
  projectVerified: boolean;
  slots: number[];
  status: ProjectHealthStatus;
  quotaKind: QuotaLimitKind;
  cooldownUntil: number | null;
  consecutiveFailures: number;
  successCount: number;
  errorCount: number;
  lastErrorCode: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}

export interface AccountRuntimeState {
  slot: number;
  keyFingerprint: string;
  status: ProjectHealthStatus;
  quotaKind: QuotaLimitKind;
  cooldownUntil: number | null;
  consecutiveFailures: number;
  successCount: number;
  errorCount: number;
  lastErrorCode: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
}

interface PoolMemoryStore {
  projects: Map<string, ProjectRuntimeState>;
  accounts: Map<string, AccountRuntimeState>;
}

const GLOBAL_POOL_KEY = '__ZARKHEZ_GEMINI_POOL_STATE_V1__';

const PLACEHOLDER_KEY_PATTERNS = [
  /^your[_-]/i,
  /^changeme/i,
  /^placeholder/i,
  /^dummy/i,
  /^replace[_-]/i,
  /^AIzaSyXXXX/i,
];

const DAILY_QUOTA_OR_BILLING_RX =
  /\b(?:per[\s_-]*day|daily|rpd|requests[\s_-]*per[\s_-]*day|spending[\s_-]*limit|billing|plan and billing|exceeded your current quota|quota exceeded for quota metric.*day)\b/i;

const BILLING_LIMIT_RX =
  /\b(?:billing|spending[\s_-]*limit|payment|account[\s_-]*suspended|delinquent)\b/i;

function getPoolStore(): PoolMemoryStore {
  const g = globalThis as unknown as Record<string, PoolMemoryStore | undefined>;
  if (!g[GLOBAL_POOL_KEY]) {
    g[GLOBAL_POOL_KEY] = {
      projects: new Map<string, ProjectRuntimeState>(),
      accounts: new Map<string, AccountRuntimeState>(),
    };
  }
  return g[GLOBAL_POOL_KEY]!;
}

let ignoreEnvFileInTests = false;
let customNowProviderForTests: (() => number) | null = null;

function getCurrentPoolNow(): number {
  return customNowProviderForTests ? customNowProviderForTests() : Date.now();
}

export function setIgnoreEnvFileForTests(ignore: boolean): void {
  ignoreEnvFileInTests = ignore;
}

export function setPoolNowProviderForTests(provider: (() => number) | null): void {
  customNowProviderForTests = provider;
}

export function clearGeminiPoolStateForTests(): void {
  const g = globalThis as unknown as Record<string, PoolMemoryStore | undefined>;
  delete g[GLOBAL_POOL_KEY];
}

function readEnvFileRaw(): string | null {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      return fs.readFileSync(envPath, 'utf8');
    }
  } catch {
    // Ignore filesystem errors in edge/restricted runtimes
  }
  return null;
}

export function readGeminiEnvValue(keys: string[], skipEnvFile = false): string | undefined {
  if (typeof window !== 'undefined') return undefined;

  for (const key of keys) {
    const val = process.env[key];
    if (val && val.trim()) return val.trim();
  }

  if (skipEnvFile || ignoreEnvFileInTests) return undefined;

  const envContent = readEnvFileRaw();
  if (!envContent) return undefined;

  for (const key of keys) {
    const rgx = new RegExp(`^${key}\\s*=\\s*([^\\r\\n#]+)`, 'm');
    const match = envContent.match(rgx);
    if (match && match[1]) {
      const cleaned = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

export function isValidGeminiApiKeyFormat(key: string | undefined): key is string {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (trimmed.length < 16 || /\s/.test(trimmed)) return false;
  return !PLACEHOLDER_KEY_PATTERNS.some((rx) => rx.test(trimmed));
}

function fingerprintApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function maskApiKeySafe(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

function parseEnabledFlag(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return !/^(false|0|no|off)$/i.test(raw.trim());
}

/**
 * Loads all valid Gemini account configurations (`1..5`, or legacy fallback when none of `1..5` are set).
 * Rejects malformed/placeholder keys and keeps credential strings server-side only.
 */
export function loadConfiguredGeminiAccounts(options?: {
  skipEnvFile?: boolean;
}): GeminiAccountConfig[] {
  if (typeof window !== 'undefined') return [];

  const skipEnvFile = Boolean(options?.skipEnvFile);
  // If any slot 1..5 is explicitly present in process.env, read slot config strictly without falling back to legacy .env.local single key
  const hasExplicitMultiInProcessEnv = ([1, 2, 3, 4, 5] as const).some((slot) =>
    Boolean(process.env[`GEMINI_API_KEY_${slot}`]?.trim())
  );

  const accounts: GeminiAccountConfig[] = [];
  const useStrictProcessEnv = skipEnvFile || hasExplicitMultiInProcessEnv;

  for (const slot of [1, 2, 3, 4, 5] as const) {
    let rawKey = readGeminiEnvValue([`GEMINI_API_KEY_${slot}`], useStrictProcessEnv);
    let isLegacyFallback = false;

    // Seamless Vercel/prod compatibility: if Slot 1 uses the pre-existing GEMINI_API_KEY alongside _2.._5, keep it active as Account 1
    if (slot === 1 && !rawKey) {
      const legacyKey = readGeminiEnvValue(['GEMINI_API_KEY', 'GOOGLE_API_KEY'], useStrictProcessEnv);
      if (legacyKey) {
        rawKey = legacyKey;
        isLegacyFallback = true;
      }
    }

    if (!isValidGeminiApiKeyFormat(rawKey)) continue;

    const configuredProject = readGeminiEnvValue(
      slot === 1 ? ['GEMINI_PROJECT_ID_1', 'GEMINI_PROJECT_ID'] : [`GEMINI_PROJECT_ID_${slot}`],
      useStrictProcessEnv
    );
    const enabledRaw = readGeminiEnvValue(
      [`GEMINI_ENABLED_${slot}`],
      useStrictProcessEnv
    );
    const fingerprint = fingerprintApiKey(rawKey);
    const projectVerified = Boolean(configuredProject && configuredProject.trim());
    const effectiveProjectId = projectVerified
      ? configuredProject!.trim()
      : `${isLegacyFallback ? 'legacy-project' : `unverified-slot-${slot}-key`}-${fingerprint.slice(0, 6)}`;

    accounts.push({
      slot,
      id: `account_${slot}`,
      apiKey: rawKey.trim(),
      keyFingerprint: fingerprint,
      maskedKey: maskApiKeySafe(rawKey),
      configuredProjectId: configuredProject?.trim(),
      effectiveProjectId,
      projectVerified,
      enabled: parseEnabledFlag(enabledRaw),
      ...(isLegacyFallback ? { isLegacyFallback: true } : {}),
    });
  }

  // Deduplicate identical raw key strings cleanly while recording duplicate awareness
  const seenKeys = new Set<string>();
  const uniqueBySecret: GeminiAccountConfig[] = [];
  for (const acc of accounts) {
    if (seenKeys.has(acc.keyFingerprint)) continue;
    seenKeys.add(acc.keyFingerprint);
    uniqueBySecret.push(acc);
  }

  return uniqueBySecret;
}

export function hasAnyConfiguredGeminiAccount(): boolean {
  return loadConfiguredGeminiAccounts().some((acc) => acc.enabled);
}

function getOrCreateAccountState(acc: GeminiAccountConfig): AccountRuntimeState {
  const store = getPoolStore();
  const key = `${acc.slot}:${acc.keyFingerprint}`;
  let state = store.accounts.get(key);
  if (!state) {
    state = {
      slot: acc.slot,
      keyFingerprint: acc.keyFingerprint,
      status: acc.enabled ? 'active' : 'disabled',
      quotaKind: 'none',
      cooldownUntil: null,
      consecutiveFailures: 0,
      successCount: 0,
      errorCount: 0,
      lastErrorCode: null,
      lastSuccessAt: null,
      lastErrorAt: null,
    };
    store.accounts.set(key, state);
  } else {
    state.status = !acc.enabled
      ? 'disabled'
      : state.status === 'disabled'
      ? 'active'
      : state.status;
  }
  return state;
}

function getOrCreateProjectState(
  acc: GeminiAccountConfig,
  allAccounts: GeminiAccountConfig[]
): ProjectRuntimeState {
  const store = getPoolStore();
  const slotsSharing = allAccounts
    .filter((a) => a.effectiveProjectId === acc.effectiveProjectId)
    .map((a) => a.slot);

  let pState = store.projects.get(acc.effectiveProjectId);
  if (!pState) {
    pState = {
      effectiveProjectId: acc.effectiveProjectId,
      configuredProjectId: acc.configuredProjectId,
      projectVerified: acc.projectVerified,
      slots: slotsSharing,
      status: 'active',
      quotaKind: 'none',
      cooldownUntil: null,
      consecutiveFailures: 0,
      successCount: 0,
      errorCount: 0,
      lastErrorCode: null,
      lastSuccessAt: null,
      lastErrorAt: null,
    };
    store.projects.set(acc.effectiveProjectId, pState);
  } else {
    pState.slots = slotsSharing;
    pState.projectVerified = acc.projectVerified;
    pState.configuredProjectId = acc.configuredProjectId;
  }
  return pState;
}

function resolveStatusWithCooldown(
  status: ProjectHealthStatus,
  cooldownUntil: number | null,
  nowMs: number
): ProjectHealthStatus {
  if (status === 'disabled') return 'disabled';
  if (status === 'active' || status === 'recovering') return status;
  if (cooldownUntil !== null && nowMs >= cooldownUntil) {
    return 'recovering';
  }
  return status;
}

function combineAccountAndProjectHealth(
  acc: GeminiAccountConfig,
  accState: AccountRuntimeState,
  projState: ProjectRuntimeState,
  nowMs: number
): {
  status: ProjectHealthStatus;
  quotaKind: QuotaLimitKind;
  eligible: boolean;
  cooldownRemainingMs: number;
} {
  if (!acc.enabled) {
    return {
      status: 'disabled',
      quotaKind: 'none',
      eligible: false,
      cooldownRemainingMs: 0,
    };
  }

  const resolvedAcc = resolveStatusWithCooldown(
    accState.status,
    accState.cooldownUntil,
    nowMs
  );
  const resolvedProj = resolveStatusWithCooldown(
    projState.status,
    projState.cooldownUntil,
    nowMs
  );

  // Sync automatic transition into 'recovering' once cooldown expires
  if (resolvedAcc !== accState.status) accState.status = resolvedAcc;
  if (resolvedProj !== projState.status) projState.status = resolvedProj;

  const blockingStatuses = new Set<ProjectHealthStatus>([
    'rate_limited',
    'auth_failed',
    'unavailable',
    'disabled',
  ]);

  if (blockingStatuses.has(resolvedProj)) {
    return {
      status: resolvedProj,
      quotaKind: projState.quotaKind,
      eligible: false,
      cooldownRemainingMs: projState.cooldownUntil
        ? Math.max(0, projState.cooldownUntil - nowMs)
        : 0,
    };
  }

  if (blockingStatuses.has(resolvedAcc)) {
    return {
      status: resolvedAcc,
      quotaKind: accState.quotaKind,
      eligible: false,
      cooldownRemainingMs: accState.cooldownUntil
        ? Math.max(0, accState.cooldownUntil - nowMs)
        : 0,
    };
  }

  // Daily quota or billing limit blocks rotation until reset even during cooldown
  if (
    (projState.quotaKind === 'daily_rpd_exhausted' ||
      projState.quotaKind === 'billing_or_spending_limit') &&
    projState.cooldownUntil !== null &&
    nowMs < projState.cooldownUntil
  ) {
    return {
      status: 'recovering',
      quotaKind: projState.quotaKind,
      eligible: false,
      cooldownRemainingMs: Math.max(0, projState.cooldownUntil - nowMs),
    };
  }

  const effectiveStatus: ProjectHealthStatus =
    resolvedProj === 'recovering' || resolvedAcc === 'recovering'
      ? 'recovering'
      : 'active';

  return {
    status: effectiveStatus,
    quotaKind:
      projState.quotaKind !== 'none' ? projState.quotaKind : accState.quotaKind,
    eligible: true,
    cooldownRemainingMs: 0,
  };
}

export function parseRetryAfterMs(headerVal: string | null, nowMs = Date.now()): number | null {
  if (!headerVal) return null;
  const trimmed = headerVal.trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(Math.max(Math.round(secs * 1000), 1000), 180_000);
    }
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - nowMs;
    if (diff > 0) {
      return Math.min(Math.max(diff, 1000), 180_000);
    }
  }

  return null;
}

export function classifyGeminiHttpFailure(
  status: number,
  errorBodyText: string,
  retryAfterHeader: string | null,
  nowMs = getCurrentPoolNow()
): {
  category:
    | 'auth_failed'
    | 'rpm_temporary'
    | 'daily_quota_exhausted'
    | 'billing_limit'
    | 'service_unavailable'
    | 'bad_request';
  code: string;
  cooldownMs: number;
  allowAccountFailover: boolean;
  sanitizedReason: string;
} {
  const safeText = redactSecrets(errorBodyText || '').slice(0, 320);

  if (status === 401 || status === 403) {
    if (BILLING_LIMIT_RX.test(safeText)) {
      return {
        category: 'billing_limit',
        code: 'BILLING_OR_SPENDING_LIMIT',
        cooldownMs: 3_600_000,
        allowAccountFailover: false,
        sanitizedReason: safeText || `Billing or spending limit rejected [${status}]`,
      };
    }
    return {
      category: 'auth_failed',
      code: 'INVALID_API_KEY',
      cooldownMs: 600_000,
      allowAccountFailover: true,
      sanitizedReason: `Authentication rejected [${status}]`,
    };
  }

  if (status === 429) {
    const retryMs = parseRetryAfterMs(retryAfterHeader, nowMs);
    const isBilling = BILLING_LIMIT_RX.test(safeText);
    const isDailyQuota = DAILY_QUOTA_OR_BILLING_RX.test(safeText);

    if (isBilling) {
      return {
        category: 'billing_limit',
        code: 'QUOTA_EXHAUSTED',
        cooldownMs: 3_600_000,
        allowAccountFailover: false,
        sanitizedReason: 'Project billing or spending limit reached [429]',
      };
    }

    if (isDailyQuota) {
      return {
        category: 'daily_quota_exhausted',
        code: 'QUOTA_EXHAUSTED',
        cooldownMs: 3_600_000,
        allowAccountFailover: false,
        sanitizedReason: 'Daily project quota exhausted [429]',
      };
    }

    return {
      category: 'rpm_temporary',
      code: 'RATE_LIMITED',
      cooldownMs: retryMs ?? 30_000,
      allowAccountFailover: true,
      sanitizedReason: 'Temporary per-minute rate limit (RPM/TPM) [429]',
    };
  }

  if (status === 400 || status === 422) {
    return {
      category: 'bad_request',
      code: 'BAD_REQUEST',
      cooldownMs: 0,
      allowAccountFailover: false,
      sanitizedReason: safeText || `Client request rejected [${status}]`,
    };
  }

  // 404 (model missing) / 408 / 500 / 502 / 503 / 504
  return {
    category: 'service_unavailable',
    code: 'MODEL_UNAVAILABLE',
    cooldownMs: 25_000,
    allowAccountFailover: true,
    sanitizedReason: `Upstream Gemini service error [${status}]`,
  };
}

function recordAccountAndProjectSuccess(
  acc: GeminiAccountConfig,
  allAccounts: GeminiAccountConfig[],
  nowMs = getCurrentPoolNow()
): void {
  const accState = getOrCreateAccountState(acc);
  const projState = getOrCreateProjectState(acc, allAccounts);
  const iso = new Date(nowMs).toISOString();

  accState.status = acc.enabled ? 'active' : 'disabled';
  accState.quotaKind = 'none';
  accState.cooldownUntil = null;
  accState.consecutiveFailures = 0;
  accState.successCount += 1;
  accState.lastSuccessAt = iso;

  projState.status = 'active';
  projState.quotaKind = 'none';
  projState.cooldownUntil = null;
  projState.consecutiveFailures = 0;
  projState.successCount += 1;
  projState.lastSuccessAt = iso;
}

function recordAccountAndProjectFailure(
  acc: GeminiAccountConfig,
  allAccounts: GeminiAccountConfig[],
  failure: {
    category:
      | 'auth_failed'
      | 'rpm_temporary'
      | 'daily_quota_exhausted'
      | 'billing_limit'
      | 'service_unavailable';
    code: string;
    cooldownMs: number;
  },
  nowMs = getCurrentPoolNow()
): void {
  const accState = getOrCreateAccountState(acc);
  const projState = getOrCreateProjectState(acc, allAccounts);
  const iso = new Date(nowMs).toISOString();

  accState.errorCount += 1;
  accState.consecutiveFailures += 1;
  accState.lastErrorAt = iso;
  accState.lastErrorCode = failure.code;

  if (failure.category === 'auth_failed') {
    // Authentication failure applies to this key/account; other keys with valid auth stay usable
    accState.status = 'auth_failed';
    accState.quotaKind = 'auth_rejected';
    accState.cooldownUntil = nowMs + failure.cooldownMs;
    return;
  }

  projState.errorCount += 1;
  projState.consecutiveFailures += 1;
  projState.lastErrorAt = iso;
  projState.lastErrorCode = failure.code;

  if (failure.category === 'billing_limit') {
    projState.status = 'disabled';
    projState.quotaKind = 'billing_or_spending_limit';
    projState.cooldownUntil = nowMs + failure.cooldownMs;
    accState.status = 'disabled';
    accState.quotaKind = 'billing_or_spending_limit';
    accState.cooldownUntil = nowMs + failure.cooldownMs;
    return;
  }

  if (failure.category === 'daily_quota_exhausted') {
    projState.status = 'recovering';
    projState.quotaKind = 'daily_rpd_exhausted';
    projState.cooldownUntil = nowMs + failure.cooldownMs;
    accState.status = 'recovering';
    accState.quotaKind = 'daily_rpd_exhausted';
    accState.cooldownUntil = nowMs + failure.cooldownMs;
    return;
  }

  if (failure.category === 'rpm_temporary') {
    projState.status = 'rate_limited';
    projState.quotaKind = 'rpm_tpm_temporary';
    projState.cooldownUntil = nowMs + failure.cooldownMs;
    accState.status = 'rate_limited';
    accState.quotaKind = 'rpm_tpm_temporary';
    accState.cooldownUntil = nowMs + failure.cooldownMs;
    return;
  }

  // Temporary upstream unavailability (exponential backoff capped at 90s; never permanently disables)
  const backoffMs = Math.min(
    failure.cooldownMs * Math.pow(2, Math.max(0, projState.consecutiveFailures - 1)),
    90_000
  );
  projState.status = 'unavailable';
  projState.quotaKind = 'service_unavailable';
  projState.cooldownUntil = nowMs + backoffMs;
  accState.status = 'unavailable';
  accState.quotaKind = 'service_unavailable';
  accState.cooldownUntil = nowMs + backoffMs;
}

/**
 * Selects ordered eligible Gemini account configurations, deduplicating projects currently on cooldown.
 * Active and elapsed-cooldown (`recovering`) lower-numbered slots are ordered cleanly without skipping recovery probes.
 */
export function selectEligibleGeminiAccounts(
  allAccounts: GeminiAccountConfig[] = loadConfiguredGeminiAccounts(),
  nowMs = getCurrentPoolNow()
): {
  eligible: GeminiAccountConfig[];
  isSingleKeyMode: boolean;
  blockedByDailyQuota: boolean;
} {
  const enabledAccounts = allAccounts.filter((a) => a.enabled);
  const isSingleKeyMode = enabledAccounts.length <= 1;

  if (enabledAccounts.length === 0) {
    return { eligible: [], isSingleKeyMode: true, blockedByDailyQuota: false };
  }

  if (isSingleKeyMode) {
    // Preserve single-key model cascading while still surfacing explicit daily-quota exhaustion on failures
    return {
      eligible: enabledAccounts,
      isSingleKeyMode: true,
      blockedByDailyQuota: false,
    };
  }

  // Never evade Google daily RPD or billing/spending limits by rotating across accounts
  const hasDailyQuotaStop = enabledAccounts.some((acc) => {
    const pState = getOrCreateProjectState(acc, allAccounts);
    return (
      (pState.quotaKind === 'daily_rpd_exhausted' ||
        pState.quotaKind === 'billing_or_spending_limit') &&
      pState.cooldownUntil !== null &&
      nowMs < pState.cooldownUntil
    );
  });

  if (hasDailyQuotaStop) {
    return {
      eligible: [],
      isSingleKeyMode: false,
      blockedByDailyQuota: true,
    };
  }

  const eligible: GeminiAccountConfig[] = [];
  for (const acc of enabledAccounts) {
    const accState = getOrCreateAccountState(acc);
    const projState = getOrCreateProjectState(acc, allAccounts);
    const combined = combineAccountAndProjectHealth(acc, accState, projState, nowMs);
    if (combined.eligible) {
      eligible.push(acc);
    }
  }

  // Sort by slot ascending so recovered Account 1 reclaims priority naturally once cooldown expires
  eligible.sort((a, b) => a.slot - b.slot);

  return {
    eligible,
    isSingleKeyMode: false,
    blockedByDailyQuota: false,
  };
}

export interface GeminiFailoverRequestOptions {
  /** Candidate model or ordered list of fallback models to try on single-key / schema errors */
  models: string[];
  /** Builds request payload cleanly for a chosen model */
  buildRequestBody: (model: string) => Record<string, unknown>;
  /** Return true when HTTP 200 payload is structurally empty (non-safety) and should fall back cleanly */
  shouldRetryEmptyPayload?: (json: unknown, modelUsed: string) => boolean;
  /** Validates and parses HTTP 200 JSON payload outside network error capture */
  onSuccessResponse?: (json: unknown, modelUsed: string, accountUsed: GeminiAccountConfig) => Promise<void> | void;
  timeoutMs?: number;
  overallDeadlineMs?: number;
  /** Allows retrying schema incompatibility errors on another model */
  isSchemaErrorRetryable?: (errorText: string) => boolean;
}

export interface GeminiFailoverSuccess {
  ok: true;
  data: unknown;
  status: number;
  modelUsed: string;
  slotUsed: number;
  projectUsed: string;
  failoverSteps: number;
}

export interface GeminiFailoverFailure {
  ok: false;
  category:
    | 'missing_credentials'
    | 'all_unavailable'
    | 'auth_failed'
    | 'rate_limited'
    | 'quota_exhausted'
    | 'bad_request'
    | 'timeout'
    | 'network_error'
    | 'service_unavailable';
  statusCode: number;
  code: string;
  retryable: boolean;
  message: string;
  attempts: number;
  slotsTried: number[];
}

export type GeminiFailoverResult = GeminiFailoverSuccess | GeminiFailoverFailure;

/**
 * Executes a Google Gemini `generateContent` request with centralized 5-account health routing,
 * shared-project quota tracking, non-evading daily quota enforcement, and sub-second failover.
 */
export async function executeGeminiWithFailover(
  options: GeminiFailoverRequestOptions
): Promise<GeminiFailoverResult> {
  if (typeof window !== 'undefined') {
    return {
      ok: false,
      category: 'missing_credentials',
      statusCode: 503,
      code: 'SERVER_ONLY',
      retryable: false,
      message: 'Cloud AI requests must execute server-side only.',
      attempts: 0,
      slotsTried: [],
    };
  }

  const allAccounts = loadConfiguredGeminiAccounts();
  const enabledCount = allAccounts.filter((a) => a.enabled).length;
  if (enabledCount === 0) {
    return {
      ok: false,
      category: 'missing_credentials',
      statusCode: 503,
      code: 'MISSING_API_KEY',
      retryable: false,
      message: 'No enabled Gemini API keys are configured in server environment.',
      attempts: 0,
      slotsTried: [],
    };
  }

  const { eligible, isSingleKeyMode, blockedByDailyQuota } = selectEligibleGeminiAccounts(allAccounts);
  if (eligible.length === 0) {
    if (blockedByDailyQuota) {
      return {
        ok: false,
        category: 'quota_exhausted',
        statusCode: 429,
        code: 'QUOTA_EXHAUSTED',
        retryable: false,
        message: 'Project daily quota or spending limit reached. Requests paused cleanly without quota evasion.',
        attempts: 0,
        slotsTried: [],
      };
    }
    return {
      ok: false,
      category: 'all_unavailable',
      statusCode: 503,
      code: 'ALL_ACCOUNTS_UNAVAILABLE',
      retryable: true,
      message: 'All configured Gemini API accounts are temporarily cooling down or unavailable.',
      attempts: 0,
      slotsTried: [],
    };
  }

  const models = Array.from(new Set(options.models.filter(Boolean)));
  if (models.length === 0) {
    return {
      ok: false,
      category: 'bad_request',
      statusCode: 400,
      code: 'MISSING_MODEL',
      retryable: false,
      message: 'No Gemini model specified for request.',
      attempts: 0,
      slotsTried: [],
    };
  }

  const deadlineMs = getCurrentPoolNow() + (options.overallDeadlineMs ?? 48_000);
  const perCallTimeoutMs = options.timeoutMs ?? 14_000;

  let attempts = 0;
  const slotsTried: number[] = [];
  const failedProjectsThisCall = new Set<string>();
  let lastFailure: GeminiFailoverFailure | null = null;

  for (let aIdx = 0; aIdx < eligible.length; aIdx++) {
    const account = eligible[aIdx];

    // If another key from the SAME Google Cloud project already failed rate-limit/quota/service in this call, skip immediately!
    if (!isSingleKeyMode && failedProjectsThisCall.has(account.effectiveProjectId)) {
      continue;
    }

    if (!slotsTried.includes(account.slot)) {
      slotsTried.push(account.slot);
    }

    // In multi-account mode, fail over directly across accounts on primary model first (fast switch);
    // in single-key mode (or last remaining account), cascade through fallback models cleanly.
    const isLastEligibleAccount = aIdx === eligible.length - 1;
    const modelsForThisAccount =
      isSingleKeyMode || isLastEligibleAccount ? models : [models[0]];

    for (let mIdx = 0; mIdx < modelsForThisAccount.length; mIdx++) {
      const remainingBudget = deadlineMs - getCurrentPoolNow();
      if (remainingBudget < 2000 && attempts > 0) break;

      const candidateModel = modelsForThisAccount[mIdx];
      const modelBudget = candidateModel.includes('-lite')
        ? Math.min(perCallTimeoutMs, 10_000)
        : perCallTimeoutMs;
      const attemptTimeoutMs = Math.max(1500, Math.min(modelBudget, remainingBudget));

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        candidateModel
      )}:generateContent?key=${encodeURIComponent(account.apiKey)}`;

      attempts += 1;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.buildRequestBody(candidateModel)),
          signal: AbortSignal.timeout(attemptTimeoutMs),
        });

        if (!res.ok) {
          const rawErr = await res.text().catch(() => '');
          const classified = classifyGeminiHttpFailure(
            res.status,
            rawErr,
            res.headers.get('retry-after')
          );

          // 400 Schema incompatibility can try next model on same account
          if (
            classified.category === 'bad_request' &&
            options.isSchemaErrorRetryable?.(rawErr) &&
            mIdx < modelsForThisAccount.length - 1
          ) {
            lastFailure = {
              ok: false,
              category: 'bad_request',
              statusCode: 400,
              code: 'SCHEMA_NOT_SUPPORTED',
              retryable: true,
              message: classified.sanitizedReason,
              attempts,
              slotsTried,
            };
            continue;
          }

          if (classified.category === 'bad_request') {
            return {
              ok: false,
              category: 'bad_request',
              statusCode: res.status,
              code: classified.code,
              retryable: false,
              message: classified.sanitizedReason,
              attempts,
              slotsTried,
            };
          }

          // Update unified health/quota store
          recordAccountAndProjectFailure(account, allAccounts, {
            category: classified.category,
            code: classified.code,
            cooldownMs: classified.cooldownMs,
          });

          // NEVER evade daily quota or billing limits across accounts!
          if (
            classified.category === 'daily_quota_exhausted' ||
            classified.category === 'billing_limit'
          ) {
            return {
              ok: false,
              category: 'quota_exhausted',
              statusCode: res.status === 403 ? 403 : 429,
              code: classified.code,
              retryable: false,
              message: classified.sanitizedReason,
              attempts,
              slotsTried,
            };
          }

          if (classified.category === 'auth_failed') {
            lastFailure = {
              ok: false,
              category: 'auth_failed',
              statusCode: res.status,
              code: 'INVALID_API_KEY',
              retryable: false,
              message: classified.sanitizedReason,
              attempts,
              slotsTried,
            };
            // Stop model loop immediately on invalid key; move directly to next eligible account
            break;
          }

          if (classified.category === 'rpm_temporary') {
            failedProjectsThisCall.add(account.effectiveProjectId);
            lastFailure = {
              ok: false,
              category: 'rate_limited',
              statusCode: 429,
              code: 'RATE_LIMITED',
              retryable: true,
              message: classified.sanitizedReason,
              attempts,
              slotsTried,
            };
            if (!isSingleKeyMode && !isLastEligibleAccount) {
              break; // Immediately fail over to another independent project
            }
            continue; // Single-key fallback tries next model
          }

          // Temporary service error (404/5xx)
          failedProjectsThisCall.add(account.effectiveProjectId);
          lastFailure = {
            ok: false,
            category: 'service_unavailable',
            statusCode: res.status >= 500 ? 503 : res.status,
            code: 'MODEL_UNAVAILABLE',
            retryable: true,
            message: classified.sanitizedReason,
            attempts,
            slotsTried,
          };
          if (!isSingleKeyMode && !isLastEligibleAccount) {
            break; // Immediately switch to next healthy account
          }
          continue;
        }

        let parsedJson: unknown = null;
        try {
          parsedJson = await res.json();
        } catch {
          recordAccountAndProjectFailure(account, allAccounts, {
            category: 'service_unavailable',
            code: 'MALFORMED_JSON_PAYLOAD',
            cooldownMs: 15_000,
          });
          failedProjectsThisCall.add(account.effectiveProjectId);
          lastFailure = {
            ok: false,
            category: 'service_unavailable',
            statusCode: 502,
            code: 'MALFORMED_JSON_PAYLOAD',
            retryable: true,
            message: 'Upstream Gemini response was not valid JSON.',
            attempts,
            slotsTried,
          };
          if (!isSingleKeyMode && !isLastEligibleAccount) break;
          continue;
        }

        recordAccountAndProjectSuccess(account, allAccounts);

        if (options.shouldRetryEmptyPayload?.(parsedJson, candidateModel)) {
          lastFailure = {
            ok: false,
            category: 'service_unavailable',
            statusCode: 502,
            code: 'EMPTY_RESPONSE',
            retryable: true,
            message: 'Empty response received from Cloud Vision AI.',
            attempts,
            slotsTried,
          };
          if (mIdx < modelsForThisAccount.length - 1) continue;
          if (!isSingleKeyMode && !isLastEligibleAccount) break;
          continue;
        }

        if (options.onSuccessResponse) {
          await options.onSuccessResponse(parsedJson, candidateModel, account);
        }

        return {
          ok: true,
          data: parsedJson,
          status: res.status,
          modelUsed: candidateModel,
          slotUsed: account.slot,
          projectUsed: account.effectiveProjectId,
          failoverSteps: Math.max(0, slotsTried.length - 1),
        };
      } catch (err: unknown) {
        const isTimeout =
          (err as { name?: string })?.name === 'TimeoutError' ||
          (err as { name?: string })?.name === 'AbortError';

        recordAccountAndProjectFailure(account, allAccounts, {
          category: 'service_unavailable',
          code: isTimeout ? 'API_TIMEOUT' : 'NETWORK_ERROR',
          cooldownMs: 25_000,
        });
        failedProjectsThisCall.add(account.effectiveProjectId);

        const safeErrMsg = redactSecrets(
          err instanceof Error ? err.message : String(err)
        );

        lastFailure = {
          ok: false,
          category: isTimeout ? 'timeout' : 'network_error',
          statusCode: isTimeout ? 504 : 503,
          code: isTimeout ? 'API_TIMEOUT' : 'NETWORK_ERROR',
          retryable: true,
          message: isTimeout
            ? 'Cloud AI request timed out'
            : `Network error connecting to Gemini service: ${safeErrMsg.slice(0, 140)}`,
          attempts,
          slotsTried,
        };

        if (!isSingleKeyMode && !isLastEligibleAccount) {
          break; // Immediately switch to next healthy account
        }
      }
    }
  }

  return (
    lastFailure || {
      ok: false,
      category: 'all_unavailable',
      statusCode: 503,
      code: 'ALL_ACCOUNTS_UNAVAILABLE',
      retryable: true,
      message: 'All configured Gemini accounts failed to respond.',
      attempts,
      slotsTried,
    }
  );
}

export interface GeminiPoolSnapshot {
  configuredCount: number;
  enabledCount: number;
  eligibleCount: number;
  slots: Array<{
    slot: number;
    configured: boolean;
    enabled: boolean;
    maskedKey: string;
    projectId: string;
    projectVerified: boolean;
    status: ProjectHealthStatus;
    quotaKind: QuotaLimitKind;
    cooldownRemainingMs: number;
    successCount: number;
    errorCount: number;
    lastErrorCode: string | null;
    lastSuccessAt: string | null;
  }>;
  sharedProjects: Array<{
    projectId: string;
    projectVerified: boolean;
    slotsSharing: number[];
    status: ProjectHealthStatus;
    quotaKind: QuotaLimitKind;
    cooldownRemainingMs: number;
  }>;
}

/**
 * Returns strictly masked health & quota state across all 5 slots and shared Google Cloud projects.
 */
export function getGeminiPoolHealthSnapshot(nowMs = getCurrentPoolNow()): GeminiPoolSnapshot {
  const configuredAccounts = loadConfiguredGeminiAccounts();
  const bySlot = new Map(configuredAccounts.map((a) => [a.slot, a]));

  const slots: GeminiPoolSnapshot['slots'] = [];
  for (const slot of [1, 2, 3, 4, 5] as const) {
    const acc = bySlot.get(slot);
    if (!acc) {
      slots.push({
        slot,
        configured: false,
        enabled: false,
        maskedKey: 'Not configured',
        projectId: 'Unconfigured',
        projectVerified: false,
        status: 'disabled',
        quotaKind: 'none',
        cooldownRemainingMs: 0,
        successCount: 0,
        errorCount: 0,
        lastErrorCode: null,
        lastSuccessAt: null,
      });
      continue;
    }

    const accState = getOrCreateAccountState(acc);
    const projState = getOrCreateProjectState(acc, configuredAccounts);
    const combined = combineAccountAndProjectHealth(acc, accState, projState, nowMs);

    slots.push({
      slot,
      configured: true,
      enabled: acc.enabled,
      maskedKey: acc.maskedKey,
      projectId: acc.configuredProjectId || acc.effectiveProjectId,
      projectVerified: acc.projectVerified,
      status: combined.status,
      quotaKind: combined.quotaKind,
      cooldownRemainingMs: combined.cooldownRemainingMs,
      successCount: accState.successCount,
      errorCount: accState.errorCount,
      lastErrorCode: accState.lastErrorCode,
      lastSuccessAt: accState.lastSuccessAt,
    });
  }

  const projectGroups = new Map<string, GeminiAccountConfig[]>();
  for (const acc of configuredAccounts) {
    const group = projectGroups.get(acc.effectiveProjectId) || [];
    group.push(acc);
    projectGroups.set(acc.effectiveProjectId, group);
  }

  const sharedProjects: GeminiPoolSnapshot['sharedProjects'] = [];
  for (const [projId, group] of Array.from(projectGroups.entries())) {
    const pState = getOrCreateProjectState(group[0], configuredAccounts);
    const resolved = resolveStatusWithCooldown(
      pState.status,
      pState.cooldownUntil,
      nowMs
    );
    sharedProjects.push({
      projectId: pState.configuredProjectId || projId,
      projectVerified: pState.projectVerified,
      slotsSharing: group.map((a) => a.slot),
      status: resolved,
      quotaKind: pState.quotaKind,
      cooldownRemainingMs: pState.cooldownUntil
        ? Math.max(0, pState.cooldownUntil - nowMs)
        : 0,
    });
  }

  const { eligible } = selectEligibleGeminiAccounts(configuredAccounts, nowMs);

  return {
    configuredCount: configuredAccounts.length,
    enabledCount: configuredAccounts.filter((a) => a.enabled).length,
    eligibleCount: eligible.length,
    slots,
    sharedProjects,
  };
}
