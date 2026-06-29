import logger from '../helpers/logger.helper';
import { LOG_LEVEL } from '../constants';
import { redactSensitiveData } from './redact';

/**
 * AOP-style method logging.
 *
 * Instead of hand-writing `logger.info('enter X')` / `logger.info('exit X')` in
 * every method, decorate a method with `@LogMethod()` or a whole class with
 * `@LogClass()` and entry/exit/error are logged automatically with a standard
 * format, argument redaction, duration timing and the ambient correlation-id /
 * trace-id (supplied by the shared logger). For plain objects/instances that
 * can't use decorators, use {@link wrapWithLogging}.
 *
 * Standard format (message + structured meta):
 *   →  ClassName.method            { args }
 *   ←  ClassName.method (12ms)     { result? }
 *   ✖  ClassName.method (12ms)     { error }
 */
export interface LogMethodOptions {
  /** Level for entry/exit lines. Default `debug`. */
  level?: string;
  /** Log (redacted) call arguments on entry. Default `true`. */
  logArgs?: boolean;
  /** Log the (redacted) return value on exit. Default `false`. */
  logResult?: boolean;
  /** Log thrown errors at error level. Default `true`. */
  logErrors?: boolean;
  /** Redact sensitive fields in args/result. Default `true`. */
  redact?: boolean;
  /** Override the displayed name (defaults to `Class.method`). */
  label?: string;
}

const DEFAULTS: Required<Omit<LogMethodOptions, 'label'>> = {
  level: LOG_LEVEL.DEBUG,
  logArgs: true,
  logResult: false,
  logErrors: true,
  redact: true,
};

function maybeRedact(value: unknown, redact: boolean): unknown {
  return redact ? redactSensitiveData(value) : value;
}

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Wrap a single function with entry/exit/error logging. */
function wrapFunction(
  original: (...args: unknown[]) => unknown,
  name: string,
  options: LogMethodOptions,
): (...args: unknown[]) => unknown {
  const opts = { ...DEFAULTS, ...options };

  return function wrapped(this: unknown, ...args: unknown[]): unknown {
    const start = process.hrtime.bigint();
    const elapsedMs = (): number =>
      Number((process.hrtime.bigint() - start) / BigInt(1_000_000));

    if (opts.logArgs) {
      logger.log(opts.level, `→ ${name}`, {
        method: name,
        args: maybeRedact(args, opts.redact),
      });
    } else {
      logger.log(opts.level, `→ ${name}`, { method: name });
    }

    const onSuccess = (result: unknown): unknown => {
      const meta: Record<string, unknown> = {
        method: name,
        durationMs: elapsedMs(),
      };
      if (opts.logResult) meta.result = maybeRedact(result, opts.redact);
      logger.log(opts.level, `← ${name} (${meta.durationMs}ms)`, meta);
      return result;
    };

    const onError = (error: unknown): never => {
      if (opts.logErrors) {
        logger.error(`✖ ${name} (${elapsedMs()}ms)`, {
          method: name,
          durationMs: elapsedMs(),
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : error,
        });
      }
      throw error;
    };

    try {
      const result = original.apply(this, args);
      if (isPromise(result)) {
        return result.then(onSuccess, onError);
      }
      return onSuccess(result);
    } catch (error) {
      return onError(error);
    }
  };
}

/**
 * Method decorator — logs entry/exit/error for the decorated method.
 *
 *   class Svc { @LogMethod() async create(dto: Dto) { ... } }
 */
export function LogMethod(options: LogMethodOptions = {}): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    if (!descriptor || typeof descriptor.value !== 'function') {
      return descriptor;
    }
    const className =
      (target as { constructor?: { name?: string } })?.constructor?.name ??
      'Function';
    const name = options.label ?? `${className}.${String(propertyKey)}`;
    descriptor.value = wrapFunction(descriptor.value, name, options);
    return descriptor;
  };
}

/**
 * Class decorator — applies {@link LogMethod} to every method on the prototype.
 * Getters/setters and the constructor are left untouched.
 *
 *   @LogClass()
 *   class AccountService { async create() { ... } async list() { ... } }
 */
export function LogClass(options: LogMethodOptions = {}): ClassDecorator {
  return (<T extends { new (...args: unknown[]): object }>(
    constructor: T,
  ): T => {
    const proto = constructor.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (!desc || typeof desc.value !== 'function') continue; // skip get/set
      const name = `${constructor.name}.${key}`;
      desc.value = wrapFunction(
        desc.value as (...a: unknown[]) => unknown,
        name,
        options,
      );
      Object.defineProperty(proto, key, desc);
    }
    return constructor;
  }) as ClassDecorator;
}

/**
 * Decorator-free wrapper. Returns a proxy of `instance` whose own + prototype
 * methods are logged. Useful for singletons/objects created without classes.
 *
 *   export default wrapWithLogging(new AccountService(), { label: 'AccountService' });
 */
export function wrapWithLogging<T extends object>(
  instance: T,
  options: LogMethodOptions = {},
): T {
  const className =
    options.label ??
    (instance as { constructor?: { name?: string } })?.constructor?.name ??
    'Object';
  const cache = new Map<string | symbol, unknown>();

  return new Proxy(instance, {
    get(target, prop, receiver): unknown {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (!cache.has(prop)) {
        const name = `${className}.${String(prop)}`;
        cache.set(
          prop,
          wrapFunction(
            value.bind(target) as (...a: unknown[]) => unknown,
            name,
            options,
          ),
        );
      }
      return cache.get(prop);
    },
  });
}
