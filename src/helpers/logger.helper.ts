import * as winston from 'winston';
import { trace } from '@opentelemetry/api';
import { ENVIRONMENT } from '../constants';
import { getSharedConfig } from '../runtime';
import { asyncLocalStorage } from './asyncLocalStorage.helper';

/**
 * Structured Winston logger shared across every service.
 *
 * The logger is built lazily on first use so that it can read the resolved
 * {@link getSharedConfig} (service name, environment, log levels). Call
 * `initSharedConfig({ serviceName, nodeEnv })` at bootstrap before the first
 * log line to get correct meta — if you don't, sensible env-derived defaults
 * are used.
 */

const addCorrelationIdFormat = winston.format((info) => {
  const store = asyncLocalStorage.getStore();
  if (store?.correlationId) {
    info.correlationId = store.correlationId;
  }
  return info;
});

const addOtelContextFormat = winston.format((info) => {
  const span = trace.getActiveSpan();
  if (span?.isRecording()) {
    const ctx = span.spanContext();
    info.traceId = ctx.traceId;
    info.spanId = ctx.spanId;
  }
  return info;
});

const logFormatJson = winston.format.combine(
  addCorrelationIdFormat(),
  addOtelContextFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

const logFormatConsole = winston.format.combine(
  addCorrelationIdFormat(),
  addOtelContextFormat(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    ({ timestamp, level, message, correlationId, ...meta }) => {
      const correlationStr = correlationId ? `[${correlationId}]` : '';
      const metaStr = Object.keys(meta).length
        ? JSON.stringify(meta, null, 2)
        : '';
      return `${timestamp} ${level} ${correlationStr} ${message} ${metaStr}`;
    },
  ),
);

/** Build (once) the underlying Winston logger from the resolved runtime config. */
function buildLogger(): winston.Logger {
  const { serviceName, nodeEnv, logLevels } = getSharedConfig();
  const isLocal = nodeEnv === ENVIRONMENT.LOCAL;

  const instance = winston.createLogger({
    defaultMeta: { service: serviceName },
    transports: [],
  });

  instance.add(
    new winston.transports.Console({
      level: isLocal ? logLevels.terminal : logLevels.elk,
      stderrLevels: ['error'],
      format: isLocal ? logFormatConsole : logFormatJson,
    }),
  );

  // Wrap logger methods to make them safe - logging should never crash the app.
  const wrap = (fn: winston.LeveledLogMethod): winston.LeveledLogMethod =>
    ((message: unknown, ...args: unknown[]) => {
      try {
        return fn(message as string, ...args);
      } catch {
        // Silent fail - return logger for chaining.
        return instance;
      }
    }) as winston.LeveledLogMethod;

  instance.info = wrap(instance.info.bind(instance));
  instance.error = wrap(instance.error.bind(instance));
  instance.warn = wrap(instance.warn.bind(instance));
  instance.debug = wrap(instance.debug.bind(instance));

  return instance;
}

let instance: winston.Logger | null = null;

/** Lazily resolve (and cache) the shared logger instance. */
export function getLogger(): winston.Logger {
  if (!instance) {
    instance = buildLogger();
  }
  return instance;
}

/**
 * Default export: a thin proxy that forwards to the lazily-built logger. This
 * preserves the ergonomic `import logger from '...'; logger.info(...)` usage
 * while deferring construction until after `initSharedConfig`.
 */
const logger = new Proxy({} as winston.Logger, {
  get(_target, prop: string | symbol) {
    const real = getLogger() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(real)
      : value;
  },
});

export { logger };
export default logger;
