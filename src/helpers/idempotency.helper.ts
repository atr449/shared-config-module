import * as crypto from 'crypto';
import { canonicalize } from 'json-canonicalize';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_PARAM_REGEX =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/\d+/gi;

/** True if `key` is a valid UUID v4 (the required idempotency-key format). */
export function validateIdempotencyKey(key: string): boolean {
  return UUID_V4_REGEX.test(key);
}

/** Normalise a request path so `/x/{uuid|id}` collapses to `/x/{id}`. */
export function normalizePath(path: string): string {
  return path
    .toLowerCase()
    .replace(/\/$/, '')
    .replace(PATH_PARAM_REGEX, '/{id}');
}

/** Deterministic SHA-256 of a canonicalised request body (order-independent). */
export function canonicalizeAndHash(body: object): string {
  const canonical = canonicalize(body) ?? '{}';
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Redis cache key. `keyPrefix` is the per-service namespace (e.g. the service
 * name) — previously hard-coded per copy, now injected so the logic is shared.
 */
export function buildRedisKey(
  keyPrefix: string,
  ownerKey: string,
  method: string,
  path: string,
  key: string,
): string {
  return `${keyPrefix}:idempotency:${ownerKey}:${method}:${path}:${key}`;
}

/** Redis distributed-lock key (namespaced like {@link buildRedisKey}). */
export function buildLockKey(
  keyPrefix: string,
  ownerKey: string,
  method: string,
  path: string,
  key: string,
): string {
  return `${keyPrefix}:idempotency:lock:${ownerKey}:${method}:${path}:${key}`;
}
