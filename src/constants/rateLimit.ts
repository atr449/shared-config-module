/**
 * Default rate-limiting configuration.
 * Consumed by each service's rate limiter middleware (Redis or in-memory store).
 */
export const RATE_LIMIT = {
  GENERAL: {
    KEY_PREFIX: 'rl:general:',
    POINTS: 100, // 100 requests
    DURATION: 60, // per 60 seconds
    BLOCK_DURATION: 300, // block for 5 minutes (300 seconds)
  },
  API: {
    KEY_PREFIX: 'rl:api:',
    POINTS: 1000, // 1000 requests
    DURATION: 3600, // per hour (3600 seconds)
    BLOCK_DURATION: 600, // block for 10 minutes (600 seconds)
  },
} as const;
