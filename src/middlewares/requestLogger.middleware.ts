import { Request, Response, NextFunction } from 'express';
import logger from '../helpers/logger.helper';
import { HTTP_METHODS, HTTP_STATUS_CODES, LOGGING_CONFIG } from '../constants';
import { GenericRequestPusher } from '../interfaces/responses.interface';

/**
 * Deep clone and redact sensitive fields from an object.
 */
function redactSensitiveData(
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

/**
 * Mask a value showing only last N characters.
 */
function maskValue(
  value: string,
  visibleChars: number = LOGGING_CONFIG.MASK_VISIBLE_CHARS,
): string {
  if (!value || value.length <= visibleChars) {
    return '[MASKED]';
  }
  return `[MASKED]...${value.slice(-visibleChars)}`;
}

/**
 * Extract and sanitize headers for logging.
 */
function getSanitizedHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const header of LOGGING_CONFIG.LOGGED_HEADERS) {
    const value = req.get(header);
    if (value) {
      headers[header] = value;
    }
  }

  for (const header of LOGGING_CONFIG.MASKED_HEADERS) {
    const value = req.get(header);
    if (value) {
      headers[header] = maskValue(value);
    }
  }

  return headers;
}

/**
 * Get request body for logging (with size limit and redaction).
 */
function getLoggableBody(
  body: unknown,
):
  | unknown
  | { _truncated: boolean; _originalSize: number; _message: string }
  | undefined {
  if (!body || Object.keys(body).length === 0) {
    return undefined;
  }

  const stringified = JSON.stringify(body);
  if (stringified.length > LOGGING_CONFIG.MAX_BODY_LOG_SIZE) {
    return {
      _truncated: true,
      _originalSize: stringified.length,
      _message: `Body too large to log (${stringified.length} bytes)`,
    };
  }

  return redactSensitiveData(body);
}

/**
 * Get client IP address (handles proxies).
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  const realIp = req.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Get route pattern if available (e.g., /users/:id instead of /users/123).
 */
function getRoutePattern(req: Request): string {
  if (req.route?.path) {
    return `${req.baseUrl}${req.route.path}`;
  }
  return req.path;
}

/**
 * Extract user info from request if available.
 */
function getUserContext(req: Request): Record<string, unknown> | undefined {
  const userInfo = (
    req as Request & {
      userInfo?: GenericRequestPusher & {
        id?: string;
        email?: string;
        role?: string;
      };
    }
  ).userInfo;
  if (!userInfo) return undefined;

  return {
    userId: userInfo.userId || userInfo.id,
    email: userInfo.email ? maskValue(userInfo.email, 8) : undefined,
    role: userInfo.role,
  };
}

/**
 * Production-grade request logging middleware.
 *
 * Features: structured JSON logging, correlation id, sensitive-data redaction,
 * request/response body logging with size limits, performance timing, error
 * response capture, and user context when available.
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip OPTIONS requests (CORS preflight)
  if (req.method === HTTP_METHODS.OPTIONS) {
    return next();
  }

  const shouldSkipDetailedLogging = LOGGING_CONFIG.EXCLUDED_PATHS.some((path) =>
    req.path.includes(path),
  );

  const startTime = process.hrtime.bigint();

  // Capture response body for error logging
  const originalSend = res.send.bind(res);
  let responseBody: unknown;

  res.send = function (body?: unknown): Response {
    responseBody = body;
    return originalSend(body);
  };

  if (!shouldSkipDetailedLogging) {
    logger.info('REQUEST START', {
      method: req.method,
      path: req.path,
      route: getRoutePattern(req),
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      body: getLoggableBody(req.body),
      headers: getSanitizedHeaders(req),
      clientIp: getClientIp(req),
      user: getUserContext(req),
      protocol: req.protocol,
      httpVersion: req.httpVersion,
    });
  }

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationNs = endTime - startTime;
    const durationMs = Number(durationNs / BigInt(1000000));
    const durationFormatted =
      durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(2)}s`;

    const isError = res.statusCode >= HTTP_STATUS_CODES.BAD_REQUEST;
    const isServerError =
      res.statusCode >= HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    const logLevel = isServerError ? 'error' : isError ? 'warn' : 'info';

    let parsedResponseBody: unknown;
    if (isError && responseBody) {
      try {
        parsedResponseBody =
          typeof responseBody === 'string'
            ? JSON.parse(responseBody)
            : responseBody;
        parsedResponseBody = redactSensitiveData(parsedResponseBody);
      } catch {
        parsedResponseBody =
          typeof responseBody === 'string' && responseBody.length < 500
            ? responseBody
            : '[UNPARSEABLE_RESPONSE]';
      }
    }

    const logData: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      route: getRoutePattern(req),
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      duration: durationFormatted,
      durationMs,
      contentLength: res.get('content-length'),
      clientIp: getClientIp(req),
      user: getUserContext(req),
    };

    if (isError && parsedResponseBody) {
      logData.response = parsedResponseBody;
    }

    if (durationMs > 5000) {
      logData.performanceWarning = 'SLOW_REQUEST';
    }

    if (shouldSkipDetailedLogging && !isError) {
      return;
    }

    logger[logLevel]('REQUEST END', logData);
  });

  res.on('error', (error: Error) => {
    logger.error('RESPONSE ERROR', {
      method: req.method,
      path: req.path,
      error: error.message,
      stack: error.stack,
    });
  });

  next();
}

export { redactSensitiveData, maskValue };
