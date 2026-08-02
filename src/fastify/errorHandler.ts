import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { fastifyResponseHelper } from './response.helper';
import { checkDbError } from '../helpers/dbError.helper';
import logger from '../helpers/logger.helper';
import BaseHttpException from '../exceptions/BaseHttpException';
import { LOG_LEVEL, ENVIRONMENT, HTTP_STATUS_CODES } from '../constants';

/**
 * Fastify port of {@link errorMiddleware}.
 *
 * Registered with `fastify.setErrorHandler(...)` rather than as a plugin —
 * Fastify has a dedicated slot for this, and only one can be active per scope.
 *
 * Why this exists centrally rather than as a hook: a middleware that catches
 * its own error and calls `reply.send()` without rethrowing cannot reliably
 * stop the preHandler chain, because `reply.sent` only flips once the send has
 * completed. So handlers throw, and this is the single place that maps, logs
 * and formats the failure.
 *
 * Stack traces and validation details are withheld in production — the client
 * gets a clean envelope, the detail goes to the logs.
 */
export function errorHandler(
  err: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const correlationId = (
    request as FastifyRequest & { correlationId?: string }
  ).correlationId;

  const mapped = checkDbError(err);
  const error: unknown = mapped || err;
  const meta = buildErrorMeta(error, request);
  const level =
    meta.statusCode >= HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR
      ? LOG_LEVEL.ERROR
      : LOG_LEVEL.WARN;

  logger.log(level, 'REQUEST FAILED', meta);

  fastifyResponseHelper.error(reply, mapped || err, correlationId, request.url);
}

function buildErrorMeta(
  err: unknown,
  request: FastifyRequest,
): { statusCode: number; [key: string]: unknown } {
  const isProd = process.env.NODE_ENV === ENVIRONMENT.PROD;
  const base = { path: request.url, method: request.method };

  if (err instanceof BaseHttpException) {
    return {
      ...base,
      statusCode: err.statusCode,
      error: { name: err.name, message: err.message },
      details: isProd ? undefined : err.errors,
    };
  }
  if (err instanceof Error) {
    return {
      ...base,
      statusCode: HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR,
      error: {
        name: err.name,
        message: err.message,
        stack: isProd ? undefined : err.stack,
      },
    };
  }
  return {
    ...base,
    statusCode: HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR,
    error: err,
  };
}

export default errorHandler;
