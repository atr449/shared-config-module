/**
 * Default idempotency timing configuration (Redis-backed key/lock TTLs and
 * reaper cadence). Duplicated verbatim across every BaaS service's
 * idempotency middleware. Each service still reads its own
 * IDEMPOTENCY_* env vars for per-environment overrides; these are only the
 * shared fallback defaults, e.g.:
 *
 *   SUCCESS_TTL_SECONDS: parseInt(
 *     process.env.IDEMPOTENCY_SUCCESS_TTL_SECONDS || String(IDEMPOTENCY_CONFIG.SUCCESS_TTL_SECONDS),
 *     10,
 *   ),
 */
export const IDEMPOTENCY_CONFIG = {
  SUCCESS_TTL_SECONDS: 24 * 60 * 60,
  FAILED_TTL_SECONDS: 60 * 60,
  LOCK_TTL_SECONDS: 90,
  LOCK_WAIT_TIMEOUT_MS: 60 * 1000,
  LOCK_POLL_INTERVAL_MS: 500,
  REAPER_INTERVAL_MS: 60 * 1000,
  MAX_PROCESSING_DURATION_SECONDS: 120,
  REAPER_BATCH_SIZE: 500,
} as const;
