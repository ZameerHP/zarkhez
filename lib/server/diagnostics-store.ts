import { redactSecrets, generateRequestId } from '../error-sanitizer';

export type DiagnosticService =
  | 'vision'
  | 'tts'
  | 'weather'
  | 'database'
  | 'chat'
  | 'advice'
  | 'geocode'
  | 'admin';

export type DiagnosticSeverity = 'info' | 'warn' | 'error';

export interface InternalDiagnosticEvent {
  requestId: string;
  timestamp: string;
  service: DiagnosticService;
  category: string;
  code: string;
  statusCode: number;
  severity: DiagnosticSeverity;
  summary: string;
  fieldPaths?: string[];
}

export interface ServiceHealthMetric {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  successCount: number;
  errorCount: number;
}

interface DiagnosticsStoreState {
  events: InternalDiagnosticEvent[];
  metrics: Record<DiagnosticService, ServiceHealthMetric>;
}

const MAX_DIAGNOSTIC_EVENTS = 120;

const GLOBAL_STORE_KEY = '__ZARKHEZ_INTERNAL_DIAGNOSTICS_V1__';

function createInitialMetrics(): Record<DiagnosticService, ServiceHealthMetric> {
  const empty = (): ServiceHealthMetric => ({
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    successCount: 0,
    errorCount: 0,
  });
  return {
    vision: empty(),
    tts: empty(),
    weather: empty(),
    database: empty(),
    chat: empty(),
    advice: empty(),
    geocode: empty(),
    admin: empty(),
  };
}

function getStore(): DiagnosticsStoreState {
  const g = globalThis as unknown as Record<string, DiagnosticsStoreState | undefined>;
  if (!g[GLOBAL_STORE_KEY]) {
    g[GLOBAL_STORE_KEY] = {
      events: [],
      metrics: createInitialMetrics(),
    };
  }
  return g[GLOBAL_STORE_KEY]!;
}

export function recordDiagnosticSuccess(service: DiagnosticService): void {
  const store = getStore();
  const m = store.metrics[service];
  m.successCount += 1;
  m.lastSuccessAt = new Date().toISOString();
}

export function recordDiagnosticEvent(input: {
  requestId?: string;
  service: DiagnosticService;
  category: string;
  code: string;
  statusCode: number;
  severity?: DiagnosticSeverity;
  summary: string;
  fieldPaths?: string[];
}): string {
  const requestId = input.requestId || generateRequestId();
  const store = getStore();
  const now = new Date().toISOString();

  const event: InternalDiagnosticEvent = {
    requestId,
    timestamp: now,
    service: input.service,
    category: redactSecrets(input.category).slice(0, 64),
    code: redactSecrets(input.code).slice(0, 64),
    statusCode: input.statusCode,
    severity: input.severity || (input.statusCode >= 500 ? 'error' : 'warn'),
    summary: redactSecrets(input.summary).slice(0, 320),
    ...(input.fieldPaths && input.fieldPaths.length > 0
      ? { fieldPaths: input.fieldPaths.slice(0, 12) }
      : {}),
  };

  store.events.unshift(event);
  if (store.events.length > MAX_DIAGNOSTIC_EVENTS) {
    store.events.length = MAX_DIAGNOSTIC_EVENTS;
  }

  const m = store.metrics[input.service];
  m.errorCount += 1;
  m.lastErrorAt = now;
  m.lastErrorCode = event.code;

  return requestId;
}

export function getInternalDiagnosticsSnapshot(): {
  generatedAt: string;
  envConfiguration: Record<string, { configured: boolean; masked: string }>;
  services: Record<DiagnosticService, ServiceHealthMetric>;
  recentEvents: InternalDiagnosticEvent[];
} {
  const store = getStore();

  const maskPresence = (envNames: string[]): { configured: boolean; masked: string } => {
    const isSet = envNames.some((n) => Boolean(process.env[n]?.trim()));
    return {
      configured: isSet,
      masked: isSet ? '•••••••• (Configured server-side)' : 'Not configured',
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    envConfiguration: {
      visionAiKey: maskPresence(['GEMINI_API_KEY', 'GOOGLE_API_KEY']),
      azureSpeechKey: maskPresence(['AZURE_SPEECH_KEY']),
      supabasePublicConfig: maskPresence(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']),
      supabaseServiceRole: maskPresence(['SUPABASE_SERVICE_ROLE_KEY']),
      upstashRateLimit: maskPresence(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']),
      adminAllowlist: maskPresence(['ADMIN_EMAILS', 'ADMIN_DIAGNOSTICS_SECRET']),
    },
    services: JSON.parse(JSON.stringify(store.metrics)) as Record<DiagnosticService, ServiceHealthMetric>,
    recentEvents: store.events.slice(0, 60),
  };
}

export function clearInternalDiagnosticsForTests(): void {
  const g = globalThis as unknown as Record<string, DiagnosticsStoreState | undefined>;
  delete g[GLOBAL_STORE_KEY];
}
