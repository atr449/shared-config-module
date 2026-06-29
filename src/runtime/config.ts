/**
 * Shared runtime configuration.
 *
 * Several pieces of shared infrastructure (the Winston logger, the OpenTelemetry
 * tracer, the request logger) need to know *which* service they are running
 * inside and how it is configured. Rather than have each consumer hard-code a
 * `SERVICE_NAME` constant (the old, duplicated approach), every service
 * initialises this singleton **once** at process bootstrap and the shared
 * modules read from it lazily.
 *
 * Usage (top of `server.ts`, after env is loaded):
 *
 *   import { initSharedConfig } from '@fusionxglobal/shared-config';
 *
 *   initSharedConfig({
 *     serviceName: 'accounts-service',
 *     nodeEnv: process.env.NODE_ENV,
 *   });
 *
 * Everything downstream (`logger`, `startTracing()`, middlewares) then resolves
 * the correct values automatically.
 */

export interface LogLevels {
  /** Level emitted to the JSON/console transport in deployed environments. */
  elk: string;
  /** Level emitted to the colourised console transport when running locally. */
  terminal: string;
}

export interface SharedRuntimeConfig {
  /** Logical service name, e.g. `accounts-service`. Used for log meta + tracing. */
  serviceName: string;
  /** Current environment: `local` | `dev` | `qa` | `uat` | `stage` | `prod`. */
  nodeEnv: string;
  /** Per-transport log levels. */
  logLevels: LogLevels;
  /** OpenTelemetry namespace grouping all FusionX services. */
  serviceNamespace: string;
  /** Service version reported as a resource attribute on spans/metrics. */
  serviceVersion: string;
}

const ENV = (typeof process !== 'undefined' && process.env) || ({} as NodeJS.ProcessEnv);

function buildDefaults(): SharedRuntimeConfig {
  return {
    serviceName:
      ENV.SERVICE_NAME || ENV.OTEL_SERVICE_NAME || 'unknown-service',
    nodeEnv: ENV.NODE_ENV || 'local',
    logLevels: {
      elk: ENV.ELK_LOG_LEVEL || 'info',
      terminal: ENV.TERMINAL_LOG_LEVEL || 'debug',
    },
    serviceNamespace: ENV.OTEL_SERVICE_NAMESPACE || 'vasp',
    serviceVersion: ENV.SERVICE_VERSION || '1.0.0',
  };
}

let current: SharedRuntimeConfig = buildDefaults();
let initialised = false;

/**
 * Initialise (or partially override) the shared runtime configuration.
 * Safe to call more than once; later calls shallow-merge over earlier values.
 * Returns the resolved, effective configuration.
 */
export function initSharedConfig(
  config: Partial<SharedRuntimeConfig> = {},
): SharedRuntimeConfig {
  current = {
    ...current,
    ...config,
    logLevels: {
      ...current.logLevels,
      ...(config.logLevels ?? {}),
    },
  };
  initialised = true;
  return current;
}

/** Read the current effective runtime configuration. */
export function getSharedConfig(): SharedRuntimeConfig {
  return current;
}

/** Whether `initSharedConfig` has been called explicitly by the host service. */
export function isSharedConfigInitialised(): boolean {
  return initialised;
}

/** Test/utility helper — restore configuration back to env-derived defaults. */
export function resetSharedConfig(): void {
  current = buildDefaults();
  initialised = false;
}
