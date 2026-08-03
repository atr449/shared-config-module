import Fastify, { FastifyInstance } from 'fastify';
import { errorHandler } from './errorHandler';
import { BadRequestException, ValidationException } from '../exceptions/http';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler(errorHandler);

  app.get('/http-error', async () => {
    throw new BadRequestException('bad input');
  });
  app.get('/validation-error', async () => {
    throw new ValidationException([{ field: 'iban', message: 'is required' }]);
  });
  app.get('/unknown-error', async () => {
    throw new Error('internal detail that must not leak');
  });

  await app.ready();
  return app;
}

describe('errorHandler (Fastify)', () => {
  let app: FastifyInstance;
  const originalEnv = process.env.NODE_ENV;

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
    if (app) await app.close();
  });

  it('maps a BaseHttpException to its own status and message', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/http-error' });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('bad input');
    expect(body.statusCode).toBe(400);
    expect(body.timestamp).toBeDefined();
  });

  it('includes field-level detail for validation errors', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/validation-error' });

    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([
      { field: 'iban', message: 'is required' },
    ]);
  });

  // The property that matters: an unexpected throwable must not leak its
  // message or stack to the caller.
  it('returns a generic envelope for an unknown error, leaking nothing', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/unknown-error' });

    expect(res.statusCode).toBe(500);
    const raw = res.body;
    expect(raw).not.toContain('internal detail that must not leak');
    expect(raw).not.toContain('at Object');
    expect(res.json().success).toBe(false);
  });

  it('echoes the request correlation id into the error envelope', async () => {
    const withCorrelation = Fastify();
    withCorrelation.setErrorHandler(errorHandler);
    withCorrelation.addHook('onRequest', async (request) => {
      (request as typeof request & { correlationId?: string }).correlationId =
        'corr-123';
    });
    withCorrelation.get('/boom', async () => {
      throw new BadRequestException('nope');
    });
    await withCorrelation.ready();

    const res = await withCorrelation.inject({ method: 'GET', url: '/boom' });
    expect(res.json().correlationId).toBe('corr-123');
    await withCorrelation.close();
  });

  it('includes the request path in the envelope', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/http-error' });
    expect(res.json().path).toBe('/http-error');
  });
});
