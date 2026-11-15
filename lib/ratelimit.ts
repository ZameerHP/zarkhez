import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Rate limiter for AI endpoints (Section 13 of SPEC.md):
 * 20 AI calls per 10 minutes per IP.
 * Uses Upstash Redis when env vars are set, with a clean in-memory sliding window fallback.
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 20;

const memoryBuckets = new Map<string, number[]>();

let redisClient: Redis | null = null;
const upstashLimiters = new Map<string, Ratelimit>();

if (
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
) {
  try {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch {
    redisClient = null;
  }
}

function getUpstashLimiter(maxRequests: number, windowMs: number): Ratelimit | null {
  if (!redisClient) return null;
  const cacheKey = `${maxRequests}:${windowMs}`;
  const existing = upstashLimiters.get(cacheKey);
  if (existing) return existing;
  try {
    const windowSeconds = Math.max(10, Math.round(windowMs / 1000));
    const limiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
      analytics: false,
    });
    upstashLimiters.set(cacheKey, limiter);
    return limiter;
  } catch {
    return null;
  }
}

export async function checkRateLimit(
  ip: string,
  options?: {
    maxRequests?: number;
    windowMs?: number;
    namespace?: string;
  }
): Promise<{
  success: boolean;
  remaining: number;
}> {
  const maxRequests = Math.max(1, options?.maxRequests ?? MAX_REQUESTS);
  const windowMs = Math.max(1000, options?.windowMs ?? WINDOW_MS);
  const rawIp = ip || 'anonymous';
  const key = options?.namespace ? `${options.namespace}:${rawIp}` : rawIp;

  const upstashLimiter = getUpstashLimiter(maxRequests, windowMs);
  if (upstashLimiter) {
    try {
      const res = await upstashLimiter.limit(key);
      return { success: res.success, remaining: res.remaining };
    } catch {
      // Fall back to in-memory limiter if Upstash is unreachable
    }
  }

  const now = Date.now();
  const timestamps = (memoryBuckets.get(key) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= maxRequests) {
    memoryBuckets.set(key, timestamps);
    return { success: false, remaining: 0 };
  }

  timestamps.push(now);
  memoryBuckets.set(key, timestamps);
  return {
    success: true,
    remaining: maxRequests - timestamps.length,
  };
}
