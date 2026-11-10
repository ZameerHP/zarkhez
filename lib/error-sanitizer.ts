import type { ScanErrorCategory } from './schemas';
import { getCustomerErrorMessage, type CustomerErrorContext } from './customer-messages';

export { getCustomerErrorMessage, type CustomerErrorContext };

/**
 * Centralized Error-to-User Sanitization & Secret Redaction System (lib/error-sanitizer.ts)
 * - Guarantees ZERO API keys, secrets, stack traces, Zod traces, HTTP status codes,
 *   file paths, or SQL/framework internals ever reach customer-facing UI or responses.
 * - Produces simple, farmer-friendly Urdu & English messages with clear next actions.
 */

const SECRET_AND_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/AIza[0-9A-Za-z_-]{15,}/g, '[REDACTED_CREDENTIAL]'],
  [/AQ\.[0-9A-Za-z_-]{15,}/g, '[REDACTED_CREDENTIAL]'],
  [/sk-(?:proj-|ant-)?[0-9A-Za-z_-]{14,}/g, '[REDACTED_CREDENTIAL]'],
  [/re_[0-9A-Za-z_]{12,}/g, '[REDACTED_CREDENTIAL]'],
  [/eyJhbGci[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}(?:\.[0-9A-Za-z_-]+)?/g, '[REDACTED_TOKEN]'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'],
  [/(key|token|secret|password|authorization|ocp-apim-subscription-key)\s*[:=]\s*[^\s&"',;]+/gi, '$1=[REDACTED]'],
  [/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[REDACTED]'],
  [/[A-Za-z]:\\[^\s'"]+/g, '[INTERNAL_PATH]'],
  [/\/(?:vercel|var|home|Users|app|usr)\/[^\s'"]+/g, '[INTERNAL_PATH]'],
];

const TECHNICAL_LEAK_INDICATORS: RegExp[] = [
  /zoderror|zod validation|invalid_type|unrecognized_keys/i,
  /\bHTTP\s*[45]\d{2}\b|\bstatus\s*(?:code)?\s*[45]\d{2}\b/i,
  /\b(?:SyntaxError|TypeError|ReferenceError|RangeError|FetchError|AbortError|ENOTFOUND|ECONNREFUSED|ETIMEDOUT)\b/i,
  /at\s+[A-Za-z0-9_$.<>]+\s*\([^)]+:\d+:\d+\)/,
  /unexpected token|expected double-quoted|json at position|is not valid json/i,
  /\b(?:GEMINI_API_KEY|AZURE_SPEECH_KEY|SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|RESEND_API_KEY|ADMIN_DIAGNOSTICS_SECRET|DATABASE_URL)\b/,
  /\b(?:pg_catalog|postgrest|row-level security|violates constraint|syntax error at or near|select \* from)\b/i,
  /generativelanguage\.googleapis\.com|speech\.microsoft\.com|open-meteo\.com/i,
  /AIza[0-9A-Za-z_-]{10,}|AQ\.[0-9A-Za-z_-]{10,}|sk-[0-9A-Za-z_-]{10,}|re_[0-9A-Za-z_]{10,}/,
  /\{\s*"code"\s*:\s*"[a-z_]+"/i,
  /\bgemini\b|جیمنائی|جیمنی|جيمنائي/i,
];

export function redactSecrets(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let out = raw;
  for (const [pattern, replacement] of SECRET_AND_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function containsTechnicalLeak(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return TECHNICAL_LEAK_INDICATORS.some((rx) => {
    rx.lastIndex = 0;
    return rx.test(text);
  });
}

export function generateRequestId(prefix = 'zrk'): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

export function sanitizeCustomerText(
  candidate: string | undefined | null,
  lang: 'en' | 'ur',
  fallbackCategory: ScanErrorCategory = 'temporary_service_failure',
  context: CustomerErrorContext = 'scan'
): string {
  const safeFallback = getCustomerErrorMessage(fallbackCategory, context)[lang];
  if (!candidate || typeof candidate !== 'string') {
    return safeFallback;
  }
  const trimmed = candidate.trim();
  if (!trimmed || containsTechnicalLeak(trimmed)) {
    return safeFallback;
  }
  return redactSecrets(trimmed);
}
