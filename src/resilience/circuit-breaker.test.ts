import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
} from './circuit-breaker';

jest.mock('../helpers/logger.helper', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const boom = () => Promise.reject(new Error('upstream down'));
const ok = () => Promise.resolve('ok');

async function failTimes(breaker: CircuitBreaker, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await expect(breaker.execute(boom)).rejects.toThrow('upstream down');
  }
}

describe('CircuitBreaker', () => {
  it('stays closed and passes results through while calls succeed', async () => {
    const breaker = new CircuitBreaker('op', { failureThreshold: 3 });

    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('trips open only on the Nth consecutive failure', async () => {
    const breaker = new CircuitBreaker('op', { failureThreshold: 3 });

    await failTimes(breaker, 2);
    expect(breaker.getState()).toBe('CLOSED');

    await failTimes(breaker, 1);
    expect(breaker.getState()).toBe('OPEN');
  });

  it('resets the failure count on any success — failures must be consecutive', async () => {
    const breaker = new CircuitBreaker('op', { failureThreshold: 3 });

    await failTimes(breaker, 2);
    await breaker.execute(ok);
    await failTimes(breaker, 2);

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('short-circuits without calling upstream while open, and reports Retry-After', async () => {
    const breaker = new CircuitBreaker('payments', { failureThreshold: 1, cooldownMs: 60000 });
    await failTimes(breaker, 1);

    const upstream = jest.fn(ok);
    await expect(breaker.execute(upstream)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(upstream).not.toHaveBeenCalled();

    await breaker.execute(upstream).catch((error: CircuitOpenError) => {
      expect(error.operation).toBe('payments');
      expect(error.retryAfterSeconds).toBeGreaterThan(0);
      expect(error.retryAfterSeconds).toBeLessThanOrEqual(60);
    });
  });

  it('allows a single probe after the cooldown, and closes when it succeeds', async () => {
    const breaker = new CircuitBreaker('op', { failureThreshold: 1, cooldownMs: 50 });
    await failTimes(breaker, 1);
    expect(breaker.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 60));

    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('re-opens immediately when the half-open probe fails', async () => {
    const breaker = new CircuitBreaker('op', { failureThreshold: 3, cooldownMs: 50 });
    await failTimes(breaker, 3);

    await new Promise((resolve) => setTimeout(resolve, 60));

    // One failure re-opens, without needing to reach failureThreshold again.
    await failTimes(breaker, 1);
    expect(breaker.getState()).toBe('OPEN');

    const upstream = jest.fn(ok);
    await expect(breaker.execute(upstream)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('reset() forces the breaker closed', async () => {
    const breaker = new CircuitBreaker('op', { failureThreshold: 1 });
    await failTimes(breaker, 1);
    expect(breaker.getState()).toBe('OPEN');

    breaker.reset();

    expect(breaker.getState()).toBe('CLOSED');
    await expect(breaker.execute(ok)).resolves.toBe('ok');
  });

  it('defaults to 5 consecutive failures', async () => {
    const breaker = new CircuitBreaker('op');

    await failTimes(breaker, 4);
    expect(breaker.getState()).toBe('CLOSED');
    await failTimes(breaker, 1);
    expect(breaker.getState()).toBe('OPEN');
  });
});

describe('CircuitBreakerRegistry', () => {
  it('returns the same breaker instance per operation name', () => {
    const registry = new CircuitBreakerRegistry();

    expect(registry.get('initiate')).toBe(registry.get('initiate'));
    expect(registry.get('initiate')).not.toBe(registry.get('enquiry'));
  });

  it('isolates operations — a tripped write does not block the read that diagnoses it', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });

    await expect(registry.execute('initiate', boom)).rejects.toThrow('upstream down');
    await expect(registry.execute('initiate', ok)).rejects.toBeInstanceOf(CircuitOpenError);

    // The enquiry breaker is untouched — this is what makes recovery possible.
    await expect(registry.execute('enquiry', ok)).resolves.toBe('ok');
  });

  it('reports every known breaker state for health endpoints', async () => {
    const registry = new CircuitBreakerRegistry({ failureThreshold: 1 });
    await expect(registry.execute('initiate', boom)).rejects.toThrow();
    await registry.execute('enquiry', ok);

    expect(registry.states()).toEqual({ initiate: 'OPEN', enquiry: 'CLOSED' });

    registry.resetAll();
    expect(registry.states()).toEqual({ initiate: 'CLOSED', enquiry: 'CLOSED' });
  });
});
