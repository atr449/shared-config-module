import type { FastifyPluginAsync, FastifyPluginCallback } from 'fastify';
import { randomUUID } from 'crypto';
import { trace, context as otelContext } from '@opentelemetry/api';
import { HEADERS } from '../constants';
import { asyncLocalStorage } from '../helpers/asyncLocalStorage.helper';
import { requireOptionalPeer } from '../helpers/optionalPeer.helper';

/** `fastify-plugin` is an optional peer — only Fastify services need it. */
function fastifyPlugin(): <T extends FastifyPluginCallback | FastifyPluginAsync>(
  fn: T,
  opts?: Record<string, unknown>,
) => T {
  return requireOptionalPeer('fastify-plugin', 'Fastify correlation-id plugin');
}

export interface CorrelationIdPluginOptions {
  /**
   * Request header carrying a caller-supplied interaction id to echo back on
   * the response (FusionX/FAPI: `x-fapi-interaction-id`). Set to `false` to
   * disable echoing entirely.
   */
  interactionIdHeader?: string | false;
  /**
   * Response header carrying the platform correlation id
   * (FusionX/FAPI: `x-fxg-correlation-id`). Set to `false` to disable.
   */
  platformCorrelationHeader?: string | false;
}

const DEFAULTS: Required<CorrelationIdPluginOptions> = {
  interactionIdHeader: 'x-fapi-interaction-id',
  platformCorrelationHeader: 'x-fxg-correlation-id',
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
  const platformCorrelationHeader =
    opts.platformCorrelationHeader ?? DEFAULTS.platformCorrelationHeader;

  fastify.addHook('onRequest', (request, _reply, done) => {
    const headerName = HEADERS.CORRELATION_ID;
    const spanContext = trace.getSpanContext(otelContext.active());
    const correlationId =
      (request.headers[headerName] as string) ||
      spanContext?.traceId ||
      randomUUID();

    (request as typeof request & { correlationId?: string }).correlationId =
      correlationId;

    asyncLocalStorage.run({ correlationId }, () => {
      done();
    });
  });

  fastify.addHook('onSend', (request, reply, payload, done) => {
    const correlationId = (
      request as typeof request & { correlationId?: string }
    ).correlationId;

    // Never clobber a value a handler set deliberately.
    if (correlationId && !reply.hasHeader(HEADERS.CORRELATION_ID)) {
      reply.header(HEADERS.CORRELATION_ID, correlationId);
    }

    const spanContext = trace.getSpanContext(otelContext.active());
    if (spanContext?.traceId && !reply.hasHeader('x-trace-id')) {
      reply.header('x-trace-id', spanContext.traceId);
    }

    const interactionId = interactionIdHeader
      ? (request.headers[interactionIdHeader] as string | undefined)
      : undefined;

    if (interactionIdHeader && interactionId) {
      if (!reply.hasHeader(interactionIdHeader)) {
        reply.header(interactionIdHeader, interactionId);
      }
      if (platformCorrelationHeader && !reply.hasHeader(platformCorrelationHeader)) {
        reply.header(platformCorrelationHeader, interactionId);
      }
    } else if (
      platformCorrelationHeader &&
      correlationId &&
      !reply.hasHeader(platformCorrelationHeader)
    ) {
      // No inbound interaction id to echo (often because the request failed
      // precisely for lacking it) — fall back to the internal correlation id
      // so the header is never simply absent.
      reply.header(platformCorrelationHeader, correlationId);
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
): FastifyPluginAsync<CorrelationIdPluginOptions> {
  const wrapped = fastifyPlugin()(plugin, {
    name: 'shared-correlation-id-plugin',
  });
  // Bake the options in so callers can just `register(createCorrelationIdPlugin())`.
  const bound: FastifyPluginAsync<CorrelationIdPluginOptions> = async (
    fastify,
    opts,
  ) => wrapped(fastify, { ...options, ...opts });
  return Object.assign(bound, wrapped);
}
