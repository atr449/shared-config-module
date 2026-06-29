/**
 * Logging Configuration
 * Settings for request logging, data redaction, and security.
 */
export const LOGGING_CONFIG = {
  /**
   * Fields to redact from logs for security/privacy compliance.
   * These fields will be replaced with [REDACTED] in logs.
   */
  SENSITIVE_FIELDS: [
    'password',
    'newPassword',
    'oldPassword',
    'confirmPassword',
    'token',
    'accessToken',
    'refreshToken',
    'apiKey',
    'secret',
    'secretKey',
    'authorization',
    'creditCard',
    'cardNumber',
    'cvv',
    'ssn',
    'socialSecurityNumber',
    'pin',
    'otp',
    'privateKey',
  ] as readonly string[],

  /** Headers to include in logs (with sensitive ones masked). */
  LOGGED_HEADERS: [
    'content-type',
    'content-length',
    'user-agent',
    'accept',
    'accept-language',
    'origin',
    'referer',
    'x-forwarded-for',
    'x-real-ip',
    'x-request-id',
  ] as readonly string[],

  /** Headers that should be masked (show only last 4 chars). */
  MASKED_HEADERS: ['authorization', 'x-api-key', 'cookie'] as readonly string[],

  /**
   * Paths to exclude from detailed logging (health checks, documentation, etc.).
   * Uses includes() matching, so partial paths work
   * (e.g., '/api-docs' matches '/kyc/api/v1/api-docs').
   */
  EXCLUDED_PATHS: [
    '/health',
    '/health/live',
    '/health/ready',
    '/status',
    '/api-docs',
    '/swagger-ui',
    '/swagger.json',
  ] as readonly string[],

  /** Max body size to log (prevent huge payloads in logs). Value in bytes. */
  MAX_BODY_LOG_SIZE: 10000,

  /** Number of visible characters to show when masking values. */
  MASK_VISIBLE_CHARS: 4,

  /** Maximum depth for recursive data redaction (prevent infinite loops). */
  MAX_REDACTION_DEPTH: 10,
} as const;
