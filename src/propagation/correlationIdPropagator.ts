import {
  Context,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
  trace,
  TraceFlags,
} from '@opentelemetry/api';
import { HEADERS } from '../constants';
import { normalizeToTraceId, generateSpanId } from '../helpers/traceId.helper';

/**
 * Forces the OTel trace id for a request to be derived from the inbound
 * x-fxg-correlation-id header, so the client-supplied correlation id and the
 * exported/logged trace id are always the same value. Composed *before* the
 * standard W3C propagator in startTracing(), so internal service-to-service
 * calls (which carry a real traceparent instead of x-fxg-correlation-id) still
 * fall through to normal W3C context propagation.
 */
export class CorrelationIdPropagator implements TextMapPropagator {
  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const raw = getter.get(carrier, HEADERS.CORRELATION_ID);
    const correlationId = Array.isArray(raw) ? raw[0] : raw;
    if (!correlationId) {
      return context;
    }

    return trace.setSpanContext(context, {
      traceId: normalizeToTraceId(correlationId),
      spanId: generateSpanId(),
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });
  }

  inject(_context: Context, _carrier: unknown, _setter: TextMapSetter): void {
    // No-op: the raw correlation id is propagated downstream separately (see
    // clients/http.client.ts and grpc/base.client.ts, which read it from
    // AsyncLocalStorage), and standard traceparent injection is handled by
    // the W3C propagator this is composed with in startTracing().
  }

  fields(): string[] {
    return [HEADERS.CORRELATION_ID];
  }
}
