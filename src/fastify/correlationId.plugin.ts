import type { FastifyPluginAsync, FastifyPluginCallback } from 'fastify';
import { randomUUID } from 'crypto';
import { trace, context as otelContext } from '@opentelemetry/api';
import { HEADERS } from '../constants';
import { asyncLocalStorage } from '../helpers/asyncLocalStorage.helper';
import { requireOptionalPeer } from '../helpers/optionalPeer.helper';

/** `fastify-plugin` is an optional peer — only Fastify services need it. */
function fastifyPlugin(): <
  T extends FastifyPluginCallback | FastifyPluginAsync,
>(
  fn: T,
  opts?: Record<string, unknown>,
) => T {
  return requireOptionalPeer('fastify-plugin', 'Fastify correlation-id plugin');
}

export interface CorrelationIdPluginOptions {
  /**
   * Request header carrying a caller-supplied interaction id (FAPI:
   * `x-fapi-interaction-id`). When present it is echoed back on that header
   * AND used as the value of `HEADERS.CORRELATION_ID`, so the id the caller
   * chose is the one they see in the response. Set to `false` for services
   * that aren't VASP-facing.
   *
   * Note there is deliberately no separate "platform correlation header"
   * option: `HEADERS.CORRELATION_ID` already IS `x-fxg-correlation-id`.
   */
  interactionIdHeader?: string | false;
}

const DEFAULTS: Required<CorrelationIdPluginOptions> = {
  interactionIdHeader: 'x-fapi-interaction-id',
};

/**
 * Fastify port of {@link correlationIdMiddleware}.
 *
 * Assigns/propagates a correlation id, exposes it (and the OTel trace id) on
 * the response, and runs the request inside an AsyncLocalStorage context so
 * the shared logger stamps every line with it.
 *
 * Two behaviours here are easy to get wrong, and were wrong in most of the
 * hand-ported per-service copies this replaces:
 *
 * 1. The correlation id is seeded from the active OTel trace id *before*
 *    falling back to a random UUID. Minting a fresh UUID when a trace already
 *    exists leaves a request's logs uncorrelated with its own trace.
 *
 * 2. Response headers are set in `onSend`, which runs for EVERY response —
 *    including ones produced by a failing preHandler (auth, validation) that
 *    never reaches a route handler. Services that set these headers inside
 *    controllers silently returned no correlation id on exactly the responses
 *    you most need to trace: the failures.
 */
const plugin: FastifyPluginAsync<CorrelationIdPluginOptions> = async (
  fastify,
  opts,
) => {
  const interactionIdHeader =
    opts.interactionIdHeader ?? DEFAULTS.interactionIdHeader;

  fastify.addHook('onRequest', (request, _reply, done) => {
    const headerName = HEADERS.CORRELATION_ID;
    const spanContext = trace.getSpanContext(otelContext.active());
    const inboundCorrelationId = request.headers[headerName] as
      string | undefined;
    const correlationId =
      inboundCorrelationId || spanContext?.traceId || randomUUID();

    const req = request as typeof request & {
      correlationId?: string;
      inboundCorrelationId?: string;
    };
    req.correlationId = correlationId;
    // Tracked separately from `correlationId` above, which also holds
    // generated fallback values (trace id / random UUID) — onSend needs to
    // know whether the caller actually sent this header themselves.
    req.inboundCorrelationId = inboundCorrelationId;

    asyncLocalStorage.run({ correlationId }, () => {
      done();
    });
  });

  fastify.addHook('onSend', (request, reply, payload, done) => {
    const req = request as typeof request & {
      correlationId?: string;
      inboundCorrelationId?: string;
    };
    const correlationId = req.correlationId;
    const inboundCorrelationId = req.inboundCorrelationId;

    const interactionId = interactionIdHeader
      ? (request.headers[interactionIdHeader] as string | undefined)
      : undefined;

    // Precedence: the caller's own x-fxg-correlation-id header first (if
    // they sent one, it's the id they're already tracking — never clobber
    // it just because they also sent an interaction id); then the caller's
    // interaction id, adopted as the correlation id when they only sent
    // that; then the generated fallback. Either way it is never absent —
    // which is the whole point on error responses.
    const outboundCorrelationId =
      inboundCorrelationId || interactionId || correlationId;
    if (outboundCorrelationId && !reply.hasHeader(HEADERS.CORRELATION_ID)) {
      // Never clobber a value a handler set deliberately.
      reply.header(HEADERS.CORRELATION_ID, outboundCorrelationId);
    }

    if (
      interactionIdHeader &&
      interactionId &&
      !reply.hasHeader(interactionIdHeader)
    ) {
      reply.header(interactionIdHeader, interactionId);
    }

    const spanContext = trace.getSpanContext(otelContext.active());
    if (spanContext?.traceId && !reply.hasHeader('x-trace-id')) {
      reply.header('x-trace-id', spanContext.traceId);
    }

    done(null, payload);
  });
};

/**
 * Returns the plugin, wrapped with `fastify-plugin` so its hooks apply to the
 * whole server rather than being encapsulated in a child context.
 *
 * Exposed as a factory, not a ready-made value: wrapping requires the
 * `fastify-plugin` optional peer, and doing it at module scope would make
 * `require('fastify-plugin')` run on import of this package — breaking the
 * Express-only services that never install it.
 *
 *   fastify.register(createCorrelationIdPlugin());
 */
export function createCorrelationIdPlugin(
  options: CorrelationIdPluginOptions = {},
): FastifyPluginAsync {
  // Bind the options first, then wrap — NOT the other way around. Wrapping
  // first and copying fastify-plugin's metadata onto a binding wrapper lets
  // Fastify unwrap straight through to the unbound plugin, silently applying
  // defaults and ignoring the caller's options.
  const withOptions: FastifyPluginAsync = async (fastify) => {
    await plugin(fastify, options);
  };
  return fastifyPlugin()(withOptions, {
    name: 'shared-correlation-id-plugin',
  });
}
