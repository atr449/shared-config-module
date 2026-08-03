import logger from '../helpers/logger.helper';

/**
 * Dependency-free circuit breaker for guarding calls to a single upstream
 * operation.
 *
 * Semantics are *consecutive failure* based, not rolling-window rate based:
 * the breaker trips after `failureThreshold` failures in a row and resets its
 * counter on any success. This suits low-volume, high-value operations — a
 * payment initiation that fails five times running is a dead upstream, and
 * waiting for a rolling window to accumulate enough volume to judge an error
 * *rate* would keep sending doomed requests at money-moving endpoints.
 *
 *   CLOSED --failureThreshold consecutive failures--> OPEN
 *   OPEN --cooldownMs elapsed--> HALF_OPEN
 *   HALF_OPEN --probe succeeds--> CLOSED
 *   HALF_OPEN --probe fails--> OPEN
 *
 * State is per-process. Replicas trip independently, so the effective
 * fleet-wide threshold is `failureThreshold × replica count`. That is the
 * intended trade-off: a shared breaker would add a network round trip to
 * every guarded call and a new failure mode of its own. Treat this as load
 * shedding, not as a correctness mechanism — callers that must not double-submit
 * need their own idempotency or status-enquiry protocol regardless.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Consecutive failures that trip the breaker open. Default 5. */
  failureThreshold: number;
  /** How long (ms) the breaker stays open before allowing a half-open probe. Default 60000. */
  cooldownMs: number;
}

export const CIRCUIT_BREAKER_DEFAULTS: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60000,
};

/**
 * Thrown instead of calling the upstream while the breaker is open. Carries
 * the remaining cooldown so an HTTP layer can surface `Retry-After`.
 */
export class CircuitOpenError extends Error {
  readonly operation: string;
  readonly retryAfterSeconds: number;

  constructor(operation: string, retryAfterSeconds: number) {
    super(`Circuit open for upstream operation: ${operation}`);
    this.name = 'CircuitOpenError';
    this.operation = operation;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;

  private readonly operation: string;
  private readonly config: CircuitBreakerConfig;

  constructor(operation: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.operation = operation;
    this.config = { ...CIRCUIT_BREAKER_DEFAULTS, ...config };
  }

  /** Run `fn` under the breaker. Throws CircuitOpenError without calling it while open. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.config.cooldownMs) {
        throw new CircuitOpenError(
          this.operation,
          Math.ceil((this.config.cooldownMs - elapsed) / 1000),
        );
      }
      this.state = 'HALF_OPEN';
      logger.info('CircuitBreaker:halfOpen', { operation: this.operation });
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Current state — for health endpoints and metrics. */
  getState(): CircuitState {
    return this.state;
  }

  /** Test/ops hook: force the breaker closed and clear the failure count. */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  private onSuccess(): void {
    if (this.state !== 'CLOSED') {
      logger.info('CircuitBreaker:closed', { operation: this.operation });
    }
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    // A failed half-open probe re-opens immediately — the upstream is still sick.
    if (
      this.state === 'HALF_OPEN' ||
      this.consecutiveFailures >= this.config.failureThreshold
    ) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.warn('CircuitBreaker:opened', {
        operation: this.operation,
        consecutiveFailures: this.consecutiveFailures,
        cooldownMs: this.config.cooldownMs,
      });
    }
  }
}

/**
 * Lazily-populated map of one breaker per operation name.
 *
 * Per-operation isolation matters: a sick write endpoint must not trip the
 * breaker guarding the read endpoint used to find out what that write actually
 * did. Sharing one breaker across an entire upstream would do exactly that.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly config: Partial<CircuitBreakerConfig>;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = config;
  }

  get(operation: string): CircuitBreaker {
    let breaker = this.breakers.get(operation);
    if (!breaker) {
      breaker = new CircuitBreaker(operation, this.config);
      this.breakers.set(operation, breaker);
    }
    return breaker;
  }

  /** Run `fn` under the breaker for `operation`, creating it on first use. */
  execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return this.get(operation).execute(fn);
  }

  /** Snapshot of every known breaker's state — for health endpoints. */
  states(): Record<string, CircuitState> {
    const out: Record<string, CircuitState> = {};
    for (const [operation, breaker] of this.breakers) {
      out[operation] = breaker.getState();
    }
    return out;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}
