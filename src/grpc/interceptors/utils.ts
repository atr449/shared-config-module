import { asyncLocalStorage } from '../../helpers';
import { GrpcHandler, GrpcInterceptor } from '../types';

/** Read correlationId from the AsyncLocalStorage store (set by the logging interceptor). */
export function getCorrelationIdFromStore(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

/**
 * Apply interceptors to a handler. Applied right-to-left (last wraps first):
 * applyGrpcInterceptors(handler, validate, logging) runs logging -> validate -> handler.
 */
export function applyGrpcInterceptors<Request, Response>(
  handler: GrpcHandler<Request, Response>,
  ...interceptors: GrpcInterceptor[]
): GrpcHandler<Request, Response> {
  return interceptors.reduceRight(
    (next, interceptor) => interceptor(next),
    handler,
  );
}
