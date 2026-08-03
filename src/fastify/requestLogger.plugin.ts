import type {
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyRequest,
} from 'fastify';
import logger from '../helpers/logger.helper';
import { redactSensitiveData, maskValue } from '../logging/redact';
import { HTTP_METHODS, HTTP_STATUS_CODES, LOGGING_CONFIG } from '../constants';
import { requireOptionalPeer } from '../helpers/optionalPeer.helper';

function fastifyPlugin(): <
  T extends FastifyPluginCallback | FastifyPluginAsync,
>(
  fn: T,
  opts?: Record<string, unknown>,
) => T {
  return requireOptionalPeer('fastify-plugin', 'Fastify request-logger plugin');
}

export interface RequestLoggerPluginOptions {
  /** Requests slower than this are tagged `performanceWarning: 'SLOW_REQUEST'`. */
  slowRequestMs?: number;
}

const DEFAULT_SLOW_REQUEST_MS = 5000;

/**
 * Per-request state. Kept in a WeakMap rather than assigned onto the request
 * object: augmenting FastifyRequest from a library would ship a global
 * declaration that clashes with the consuming service's own augmentation.
 * (Same reasoning as the local casts in the Express middlewares.) Entries are
 * collected automatically when the request is.
 */
interface RequestLogState {
  skipDetailedLogging: boolean;
  responseBody?: unknown;
}
const requestState = new WeakMap<FastifyRequest, RequestLogState>();

function getSanitizedHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const header of LOGGING_CONFIG.LOGGED_HEADERS) {
    const value = request.headers[header];
    if (value) headers[header] = Array.isArray(value) ? value.join(',') : value;
  }

  for (const header of LOGGING_CONFIG.MASKED_HEADERS) {
    const value = request.headers[header];
    if (value) {
      headers[header] = maskValue(
        Array.isArray(value) ? value.join(',') : value,
      );
    }
  }

  return headers;
}

function getLoggableBody(body: unknown): unknown {
  if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
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

function getClientIp(request: FastifyRequest): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    return (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
      .split(',')[0]
      .trim();
  }
  const realIp = request.headers['x-real-ip'];
  if (realIp) return Array.isArray(realIp) ? realIp[0] : realIp;
  return request.ip || 'unknown';
}

function getRoutePattern(request: FastifyRequest): string {
  return request.routeOptions?.url || request.url.split('?')[0];
}

/**
 * Fastify port of {@link requestLoggerMiddleware}: structured request/response
 * logging with header masking, body redaction, size limits and error capture.
 *
 * Health/metrics paths (LOGGING_CONFIG.EXCLUDED_PATHS) skip the verbose
 * start/end lines but are still logged when they fail — otherwise a failing
 * health check is invisible.
 */
const plugin: FastifyPluginAsync<RequestLoggerPluginOptions> = async (
  fastify,
  opts,
) => {
  const slowRequestMs = opts.slowRequestMs ?? DEFAULT_SLOW_REQUEST_MS;

  // Runs early and unconditionally so the state exists for onResponse even if
  // the request is rejected before reaching preHandler.
  fastify.addHook('onRequest', async (request) => {
    if (request.method === HTTP_METHODS.OPTIONS) return;

    const skipDetailedLogging = LOGGING_CONFIG.EXCLUDED_PATHS.some((path) =>
      request.url.includes(path),
    );
    requestState.set(request, { skipDetailedLogging });
  });

  /**
   * REQUEST START is emitted at `preHandler`, NOT `onRequest`.
   *
   * Fastify has not parsed the body yet during onRequest — `request.body` is
   * undefined until preValidation/preHandler. The per-service copies this
   * replaces logged it in onRequest, so despite all the redaction and
   * size-limit handling, no request body was ever actually logged.
   *
   * This hook is registered on the instance, so it still runs before any
   * route-level preHandler (auth, validation) — the start line is emitted
   * before those can reject the request.
   */
  fastify.addHook('preHandler', async (request) => {
    if (request.method === HTTP_METHODS.OPTIONS) return;
    if (requestState.get(request)?.skipDetailedLogging) return;

    logger.info('REQUEST START', {
      method: request.method,
      path: request.url.split('?')[0],
      route: getRoutePattern(request),
      query:
        Object.keys((request.query as Record<string, unknown>) ?? {}).length > 0
          ? request.query
          : undefined,
      body: getLoggableBody(request.body),
      headers: getSanitizedHeaders(request),
      clientIp: getClientIp(request),
      protocol: request.protocol,
      httpVersion: request.raw.httpVersion,
    });
  });

  fastify.addHook('onSend', async (request, _reply, payload) => {
    const state = requestState.get(request);
    if (state) state.responseBody = payload;
    return payload;
  });

  fastify.addHook('onResponse', async (request, reply) => {
    if (request.method === HTTP_METHODS.OPTIONS) return;

    const state = requestState.get(request);
    const durationMs = reply.elapsedTime;
    const durationFormatted =
      durationMs < 1000
        ? `${Math.round(durationMs)}ms`
        : `${(durationMs / 1000).toFixed(2)}s`;

    const isError = reply.statusCode >= HTTP_STATUS_CODES.BAD_REQUEST;
    const isServerError =
      reply.statusCode >= HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;
    const logLevel = isServerError ? 'error' : isError ? 'warn' : 'info';

    let parsedResponseBody: unknown;
    const responseBody = state?.responseBody;
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
      method: request.method,
      path: request.url.split('?')[0],
      route: getRoutePattern(request),
      statusCode: reply.statusCode,
      duration: durationFormatted,
      durationMs,
      contentLength: reply.getHeader('content-length'),
      clientIp: getClientIp(request),
    };

    if (isError && parsedResponseBody) {
      logData.response = parsedResponseBody;
    }

    if (durationMs > slowRequestMs) {
      logData.performanceWarning = 'SLOW_REQUEST';
    }

    // Excluded paths stay quiet while healthy, but must still surface failures.
    if (state?.skipDetailedLogging && !isError) return;

    logger[logLevel]('REQUEST END', logData);
  });

  fastify.addHook('onError', async (request, _reply, error) => {
    logger.error('RESPONSE ERROR', {
      method: request.method,
      path: request.url.split('?')[0],
      error: error.message,
      stack: error.stack,
    });
  });
};

/**
 * See {@link createCorrelationIdPlugin} for why this is a factory rather than
 * a ready-made plugin value.
 *
 *   fastify.register(createRequestLoggerPlugin());
 */
export function createRequestLoggerPlugin(
  options: RequestLoggerPluginOptions = {},
): FastifyPluginAsync {
  // See createCorrelationIdPlugin: bind options first, then wrap.
  const withOptions: FastifyPluginAsync = async (fastify) => {
    await plugin(fastify, options);
  };
  return fastifyPlugin()(withOptions, {
    name: 'shared-request-logger-plugin',
  });
}
