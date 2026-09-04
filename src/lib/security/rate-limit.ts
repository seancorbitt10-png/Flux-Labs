import { RateLimitError } from "@/lib/errors";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Simple in-memory sliding fixed-window rate limiter.
 * Suitable for single-instance Phase 1; replace with Redis for multi-instance.
 */
export function assertRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): void {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }

  if (existing.count >= options.limit) {
    throw new RateLimitError();
  }

  existing.count += 1;
}

/** Test helper */
export function resetRateLimits(): void {
  buckets.clear();
}
