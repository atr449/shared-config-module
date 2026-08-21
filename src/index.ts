/**
 * @fusionxglobal/shared-config
 *
 * Shared configuration, constants, exceptions, structured logging,
 * OpenTelemetry tracing and Express middleware for FusionX VASP microservices.
 *
 * Bootstrap order in a consuming service's `server.ts`:
 *
 *   import { loadEnvSync, initSharedConfig, startTracing } from '@fusionxglobal/shared-config';
 *   loadEnvSync(__dirname + '/config');     // 1. load <env>.env
 *   initSharedConfig({ serviceName: 'accounts-service' }); // 2. configure shared infra
 *   startTracing();                          // 3. start OTel (before other requires)
 */

// Runtime configuration (object initialisation)
export * from './runtime';

// Constants & enums
export * from './constants';

// Interfaces / response contracts
export * from './interfaces';

// Exceptions
export * from './exceptions';

// Helpers (logger, response, dbError, tracing, ALS)
export * from './helpers';

// Express middlewares
export * from './middlewares';

// Fastify plugin ports of the above (correlation-id, request-logger, error handler)
export * from './fastify';

// OTel propagators
export * from './propagation';

// Client initialisers (Redis, RabbitMQ, Database/Sequelize, S3, SES)
export * from './clients';

// AOP method logging (decorators) + redaction utilities
export * from './logging';

// Environment loading & validation
export * from './env';

// Resilience primitives (circuit breaker)
export * from './resilience';
