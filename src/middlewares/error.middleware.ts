import { Request, Response, NextFunction } from 'express';
import responseHelper from '../helpers/response.helper';
import { checkDbError } from '../helpers/dbError.helper';
import logger from '../helpers/logger.helper';
import BaseHttpException from '../exceptions/BaseHttpException';
import { LOG_LEVEL, ENVIRONMENT, HTTP_STATUS_CODES } from '../constants';

/**
 * Centralised error middleware.
 *
 * Maps known Sequelize errors to HTTP exceptions, logs the failure at the
 * appropriate level (error for 5xx, warn otherwise) with structured metadata,
 * and returns a consistent error envelope via the shared response helper.
 */
export async function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,

  _next: NextFunction,
): Promise<Response> {
  const correlationId = (req as Request & { correlationId?: string })
    .correlationId;
  const mapped = checkDbError(err);
  const error: unknown = mapped || err;
  const meta = buildErrorMeta(error, req);
  const level =
    meta.statusCode >= HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR
      ? LOG_LEVEL.ERROR
      : LOG_LEVEL.WARN;
  logger.log(level, 'REQUEST FAILED', meta);

  if (mapped) {
    return responseHelper.error(res, mapped, correlationId);
  }
  return responseHelper.error(res, err, correlationId);
}

function buildErrorMeta(
  err: unknown,
  req: Request,
): { statusCode: number; [key: string]: unknown } {
  const isProd = process.env.NODE_ENV === ENVIRONMENT.PROD;
  const base = { path: req.path, method: req.method };

  if (err instanceof BaseHttpException) {
    return {
      ...base,
      statusCode: err.statusCode,
      error: {
        name: err.name,
        message: err.message,
      },
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
