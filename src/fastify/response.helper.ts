import type { FastifyReply } from 'fastify';
import BaseHttpException from '../exceptions/BaseHttpException';
import { InternalServerException } from '../exceptions/http';
import { ErrorType } from '../constants/enums';
import { COMMON_MESSAGES, HTTP_STATUS_CODES } from '../constants';

/**
 * Fastify counterpart of the Express {@link ResponseHelper}.
 *
 * A separate implementation rather than a shared one is unavoidable: Express
 * replies with `res.status(code).json(body)` and Fastify with
 * `reply.status(code).send(body)` — there is no common method. The *envelope*
 * is identical to the Express version, which is the part that matters, since
 * both shapes are visible to VASPs through the same public API.
 */

interface SuccessBody {
  success: boolean;
  message: string;
  data?: unknown;
  statusCode: number;
  timestamp: string;
  correlationId?: string;
}

interface ErrorBody {
  success: boolean;
  timestamp: string;
  message: string;
  errorType: string;
  path?: string;
  errors?: Array<{ field?: string; message: string }>;
  statusCode: number;
  correlationId?: string;
}

export class FastifyResponseHelper {
  public success(
    reply: FastifyReply,
    data: { message: string; data?: unknown; statusCode?: number },
    correlationId?: string,
  ): FastifyReply {
    const body: SuccessBody = {
      success: true,
      message: data.message,
      data: typeof data.data !== 'undefined' ? data.data : [],
      statusCode: data.statusCode ?? HTTP_STATUS_CODES.OK,
      timestamp: new Date().toISOString(),
    };
    if (correlationId) body.correlationId = correlationId;

    return reply.status(body.statusCode).send(body);
  }

  public error(
    reply: FastifyReply,
    err: unknown,
    correlationId?: string,
    path?: string,
  ): FastifyReply {
    const base: Pick<ErrorBody, 'success' | 'timestamp' | 'correlationId'> = {
      success: false,
      timestamp: new Date().toISOString(),
    };
    if (correlationId) base.correlationId = correlationId;

    if (err instanceof BaseHttpException) {
      const body: ErrorBody = {
        ...base,
        message: err.message,
        errorType: err.errorType,
        statusCode: err.statusCode,
      };
      if (path) body.path = path;
      // Field-level detail is only meaningful for validation failures; for
      // anything else it would leak internals to the caller.
      if (err.errorType === ErrorType.VALIDATION_ERROR && err.errors?.length) {
        body.errors = err.errors;
      }
      return reply.status(body.statusCode).send(body);
    }

    // Unknown throwable — never surface its message; log it and return a
    // generic envelope.
    const internal = new InternalServerException(COMMON_MESSAGES.ERROR);
    const body: ErrorBody = {
      ...base,
      message: internal.message,
      errorType: internal.errorType,
      statusCode:
        internal.statusCode ?? HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR,
    };
    if (path) body.path = path;

    return reply.status(body.statusCode).send(body);
  }
}

export const fastifyResponseHelper = new FastifyResponseHelper();
export default fastifyResponseHelper;
