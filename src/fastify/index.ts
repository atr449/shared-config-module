/**
 * Fastify ports of the Express middlewares in `src/middlewares`.
 *
 * 11 of the 12 platform services run Fastify, but this package only shipped
 * Express middleware — so each service hand-ported the same plugins and they
 * drifted apart (the correlation-id plugin alone had four variants, and most
 * copies dropped correlation headers on error responses entirely).
 *
 * `fastify` is a type-only import here and `fastify-plugin` is loaded lazily
 * behind a factory, so importing this package stays free for Express-only
 * services that install neither.
 */
export {
  createCorrelationIdPlugin,
} from './correlationId.plugin';
export type { CorrelationIdPluginOptions } from './correlationId.plugin';
