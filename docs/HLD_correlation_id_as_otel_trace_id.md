# HLD — Correlation ID as the OTel Trace ID

## 1. `constants/http.ts`

**What changed:** `HEADERS.CORRELATION_ID` renamed from `'x-correlation-id'` to `'x-fxg-correlation-id'`.

**Why:** `x-fxg-correlation-id` is the header VASP clients actually send/receive on every API today (previously only echoed back as a mirror of `x-fapi-interaction-id`, never consumed as an input). `HEADERS.CORRELATION_ID` is the single constant every other piece of this package's correlation tracking (AsyncLocalStorage, logger, gRPC interceptors, HTTP/gRPC client propagation) already keys off, so renaming it here is what makes the whole fleet start tracking the real client-supplied id instead of an unrelated internal header — no per-file duplication needed.


## 2. `helpers/traceId.helper.ts` (new)

**What changed:** Added `normalizeToTraceId(value: string): string` and `generateSpanId(): string`.

**Why:** OTel trace ids must be a 32-char lowercase-hex string and non-zero, but a client-supplied correlation id can be any string. `normalizeToTraceId` strips dashes and reuses the value directly when it's already UUID-shaped (the common case), and otherwise SHA-256 hashes it — deterministically, so the same correlation id always maps to the same trace id on every hop of a call chain.


## 3. `propagation/correlationIdPropagator.ts` (new)

**What changed:** Added `CorrelationIdPropagator`, an OTel `TextMapPropagator` whose `extract()` reads the inbound `x-fxg-correlation-id` header and, when present, forces the request's span context to `normalizeToTraceId(correlationId)` (with a fresh random span id, `isRemote: true`). `inject()` is a no-op — the raw correlation id is already forwarded downstream separately by `clients/http.client.ts` / `grpc/base.client.ts` via AsyncLocalStorage, and standard `traceparent` injection is left to the W3C propagator it's composed with.

**Why:** A span's trace id is immutable once created, and OTel's `instrumentation-http` creates the root span for an incoming request *before* any application middleware (Express/Fastify) runs — by reading straight off the raw Node http server. The only hook that runs early enough to influence the trace id is the propagator's `extract()`, called by the instrumentation while building the parent context. There is no way to achieve "correlation id = trace id" from inside a Fastify plugin or Express middleware; it has to happen at the propagator level.


## 4. `helpers/tracing.helper.ts`

**What changed:** `startTracing()`'s `NodeSDK` config now sets `textMapPropagator: new CompositePropagator({ propagators: [new CorrelationIdPropagator(), new W3CTraceContextPropagator(), new W3CBaggagePropagator()] })`.

**Why:** `CorrelationIdPropagator` only overrides the context when `x-fxg-correlation-id` is present (an external/edge request). Composing it *before* the standard W3C propagator means internal service-to-service calls — which carry a real `traceparent` instead of that header — still fall through to normal W3C extraction, so a single trace correctly spans the whole call chain regardless of which hop it enters at.


## 5. `middlewares/correlationId.middleware.ts`

**What changed:** The correlation id fallback (when no header is present) changed from an unconditional `randomUUID()` to `spanContext?.traceId || randomUUID()`, reading off the now-active OTel span context.

**Why:** By the time this middleware runs, the propagator above has already run and a span already exists. Falling back to a fresh, unrelated `randomUUID()` would leave `correlationId` (logged as-is) and `traceId` (read from the active span) disagreeing for any request that didn't send the header. Reusing the span's own trace id keeps the two fields identical in every case, not just when the client supplies one.


## 6. `package.json`

**What changed:** Added `@opentelemetry/core` as an explicit dependency (was previously only pulled in transitively via `@opentelemetry/sdk-node`).

**Why:** `CompositePropagator`, `W3CTraceContextPropagator`, and `W3CBaggagePropagator` are imported directly from `@opentelemetry/core` now, so it needs to be a first-class dependency rather than relying on hoisting from another package's install.


## Downstream impact

Every consuming service ports its own Fastify equivalent of `correlationIdMiddleware` (`fastify-plugins/correlation-id.plugin.ts`, or `middlewares/correlation-id.middleware.ts` in `baas-authentication-services`) rather than using this package's Express version directly. Those ports needed the matching fallback change (#5) applied individually, since they don't import `correlationIdMiddleware` itself — only `HEADERS` and `asyncLocalStorage`. All 11 `baas-*` services need to bump their pinned shared-config-module commit and rebuild before this takes effect.

---
*More points can be added here as further changes land in this package.*
