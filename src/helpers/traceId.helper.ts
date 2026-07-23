import { createHash, randomBytes } from 'crypto';

const HEX_32_RE = /^[0-9a-f]{32}$/;
const ALL_ZERO_TRACE_ID = '0'.repeat(32);

/**
 * OTel trace ids must be a 32-char lowercase hex string and not all-zero.
 * A UUID collapses to this directly once its dashes are stripped; any other
 * client-supplied correlation id is hashed so the same input deterministically
 * maps to the same valid trace id on every hop.
 */
export function normalizeToTraceId(value: string): string {
  const stripped = value.replace(/-/g, '').toLowerCase();
  if (HEX_32_RE.test(stripped) && stripped !== ALL_ZERO_TRACE_ID) {
    return stripped;
  }
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/** Random 16-char hex span id for the synthetic remote parent span. */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}
