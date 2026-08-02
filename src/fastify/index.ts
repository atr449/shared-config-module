/**
 * Fastify ports of the Express middlewares in `src/middlewares`.
 *
 * 11 of the 12 platform services run Fastify, but this package only shipped
 * Express middleware — so each service hand-ported the same plugins and they
 * drifted apart (the correlation-id plugin alone had four variants, the error
 * handler five, and most correlation-id copies dropped the headers entirely on
 * error responses).
 *
 * `fastify` is a type-only import throughout and `fastify-plugin` is loaded
 * lazily behind the `create*` factories, so importing this package stays free
 * for Express-only services that install neither.
 */
export { createCorrelationIdPlugin } from './correlationId.plugin';
export type { CorrelationIdPluginOptions } from './correlationId.plugin';

export { createRequestLoggerPlugin } from './requestLogger.plugin';
export type { RequestLoggerPluginOptions } from './requestLogger.plugin';

export { errorHandler } from './errorHandler';

export {
  FastifyResponseHelper,
  fastifyResponseHelper,
} from './response.helper';
