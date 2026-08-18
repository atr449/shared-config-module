import type { FastifyRequest } from 'fastify';

export interface TaggedError extends Error {
  auditAction?: string;
}

/**
 * Generic over the handler's own argument list: most preHandlers take only
 * `request` (the default), but some also need `reply` (e.g. an idempotency
 * preHandler that replays a cached response). `Args` is inferred from
 * whichever handler is passed in, so every wrapped export keeps its original
 * arity unchanged and no call site (route registration or test) needs to
 * change.
 */
export type PreHandler<Args extends unknown[] = [request: FastifyRequest]> = (
  ...args: Args
) => Promise<void>;

/**
 * Tags a thrown error with the audit action for the preHandler stage that
 * produced it (auth, idempotency, schema validation, ...), so the global
 * error handler can audit-log preHandler failures without needing to know
 * which middleware was running - the error itself carries that information.
 *
 * Errors thrown from within a controller/service method are audited
 * individually at their own call site (see `createAuditHelpers`) and are
 * never tagged here, so the error handler can tell the two apart and avoid
 * double-logging the same failure.
 */
export function withMiddlewareAudit<
  Args extends unknown[] = [request: FastifyRequest],
>(action: string, handler: PreHandler<Args>): PreHandler<Args> {
  return async (...args: Args): Promise<void> => {
    try {
      await handler(...args);
    } catch (error) {
      if (error instanceof Error) {
        (error as TaggedError).auditAction ??= action;
      }
      throw error;
    }
  };
}
