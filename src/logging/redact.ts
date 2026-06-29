import { LOGGING_CONFIG } from '../constants';

/**
 * Deep clone and redact sensitive fields from an arbitrary value.
 * Shared by the request logger and the method (AOP) logger so redaction rules
 * are defined in exactly one place ({@link LOGGING_CONFIG.SENSITIVE_FIELDS}).
 */
export function redactSensitiveData(
  obj: unknown,
  depth = 0,
): unknown | string | unknown[] | Record<string, unknown> {
  if (depth > LOGGING_CONFIG.MAX_REDACTION_DEPTH) return '[MAX_DEPTH_EXCEEDED]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, depth + 1));
  }

  const redacted: Record<string, unknown> = Object.create(null);
  const SAFE_KEY = /^[a-zA-Z0-9_-]+$/;
  for (const [key, value] of Object.entries(obj)) {
    if (!SAFE_KEY.test(key)) continue;
    const lowerKey = key.toLowerCase();
    if (
      LOGGING_CONFIG.SENSITIVE_FIELDS.some((field) =>
        lowerKey.includes(field.toLowerCase()),
      )
    ) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      redacted[key] = redactSensitiveData(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/** Mask a value showing only the last N characters. */
export function maskValue(
  value: string,
  visibleChars: number = LOGGING_CONFIG.MASK_VISIBLE_CHARS,
): string {
  if (!value || value.length <= visibleChars) {
    return '[MASKED]';
  }
  return `[MASKED]...${value.slice(-visibleChars)}`;
}
