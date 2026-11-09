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

let upstashLimiter: Ratelimit | null = null;
if (
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
) {
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    upstashLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_REQUESTS, '10 m'),
      analytics: false,
    });
  } catch {
    upstashLimiter = null;
  }
}

export async function checkRateLimit(ip: string): Promise<{
  success: boolean;
  remaining: number;
}> {
  const key = ip || 'anonymous';

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
    (t) => now - t < WINDOW_MS
  );

  if (timestamps.length >= MAX_REQUESTS) {
    memoryBuckets.set(key, timestamps);
    return { success: false, remaining: 0 };
  }

  timestamps.push(now);
  memoryBuckets.set(key, timestamps);
  return {
    success: true,
    remaining: MAX_REQUESTS - timestamps.length,
  };
}
