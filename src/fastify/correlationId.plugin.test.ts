import Fastify, { FastifyInstance } from 'fastify';
import { createCorrelationIdPlugin } from './correlationId.plugin';
import { HEADERS } from '../constants';

const INTERACTION_HEADER = 'x-fapi-interaction-id';
const PLATFORM_HEADER = 'x-fxg-correlation-id';

async function buildApp(
  opts: Parameters<typeof createCorrelationIdPlugin>[0] = {},
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(createCorrelationIdPlugin(opts));

  app.get('/ok', async () => ({ ok: true }));

  // A route whose preHandler rejects — this is the case the per-service copies
  // got wrong: they set correlation headers inside the controller, which never
  // runs when a preHandler throws.
  app.get(
    '/blocked',
    {
      preHandler: async () => {
        throw Object.assign(new Error('nope'), { statusCode: 401 });
      },
    },
    async () => ({ ok: true }),
  );

  await app.ready();
  return app;
}

describe('createCorrelationIdPlugin', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('sets a correlation id on a successful response', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ok' });

    expect(res.statusCode).toBe(200);
    expect(res.headers[HEADERS.CORRELATION_ID]).toBeDefined();
  });

  it('propagates an inbound correlation id rather than minting a new one', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [HEADERS.CORRELATION_ID]: 'inbound-correlation-id' },
    });

    expect(res.headers[HEADERS.CORRELATION_ID]).toBe('inbound-correlation-id');
  });

  // The regression this plugin exists to prevent.
  it('still sets correlation headers when a preHandler rejects before the route runs', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/blocked',
      headers: { [INTERACTION_HEADER]: 'interaction-abc' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers[HEADERS.CORRELATION_ID]).toBeDefined();
    expect(res.headers[INTERACTION_HEADER]).toBe('interaction-abc');
    expect(res.headers[PLATFORM_HEADER]).toBe('interaction-abc');
  });

  it('echoes the caller interaction id on both FAPI headers', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [INTERACTION_HEADER]: 'interaction-xyz' },
    });

    expect(res.headers[INTERACTION_HEADER]).toBe('interaction-xyz');
    expect(res.headers[PLATFORM_HEADER]).toBe('interaction-xyz');
  });

  it('falls back to the internal correlation id when no interaction id was sent', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ok' });

    // Nothing to echo, but the platform header must never simply be absent.
    expect(res.headers[INTERACTION_HEADER]).toBeUndefined();
    expect(res.headers[PLATFORM_HEADER]).toBe(res.headers[HEADERS.CORRELATION_ID]);
  });

  it('can disable the FAPI headers for non-VASP-facing services', async () => {
    app = await buildApp({
      interactionIdHeader: false,
      platformCorrelationHeader: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [INTERACTION_HEADER]: 'interaction-xyz' },
    });

    expect(res.headers[PLATFORM_HEADER]).toBeUndefined();
    // The generic correlation id is not optional — it always ships.
    expect(res.headers[HEADERS.CORRELATION_ID]).toBeDefined();
  });

  it('applies globally rather than being encapsulated (fastify-plugin wrapping)', async () => {
    const outer = Fastify();
    await outer.register(createCorrelationIdPlugin());
    // Registered in a nested scope; hooks must still apply to routes there.
    await outer.register(async (child) => {
      child.get('/nested', async () => ({ ok: true }));
    });
    await outer.ready();

    const res = await outer.inject({ method: 'GET', url: '/nested' });
    expect(res.headers[HEADERS.CORRELATION_ID]).toBeDefined();
    await outer.close();
  });
});
