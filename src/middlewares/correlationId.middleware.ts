import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { trace, context as otelContext } from '@opentelemetry/api';
import { HEADERS } from '../constants';
import { asyncLocalStorage } from '../helpers/asyncLocalStorage.helper';

/**
 * Assigns (or propagates) a correlation id for the request, exposes it on the
 * response header and the OTel trace id, and runs the rest of the request
 * inside an AsyncLocalStorage context so the logger can pick it up.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const headerName = HEADERS.CORRELATION_ID;
  const correlationId =
    (req.headers[headerName] as string) || randomUUID();

  // The consuming service owns the global Express.Request augmentation; cast
  // locally so this package ships no clashing global declaration.
  (req as Request & { correlationId?: string }).correlationId = correlationId;
  res.setHeader(headerName, correlationId);

  const end = res.end.bind(res);
  (res as any).end = (...args: any[]): Response => {
    if (!res.headersSent) {
      const spanContext = trace.getSpanContext(otelContext.active());
      if (spanContext?.traceId) {
        res.setHeader('x-trace-id', spanContext.traceId);
      }
    }
    return (end as (...a: any[]) => Response)(...args);
  };

  asyncLocalStorage.run({ correlationId }, () => {
    next();
  });
}
