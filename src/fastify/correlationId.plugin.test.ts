import Fastify, { FastifyInstance } from 'fastify';
import { createCorrelationIdPlugin } from './correlationId.plugin';
import type { CorrelationIdPluginOptions } from './correlationId.plugin';
import { HEADERS } from '../constants';

const INTERACTION_HEADER = 'x-fapi-interaction-id';
// HEADERS.CORRELATION_ID *is* `x-fxg-correlation-id` — there is no separate
// "platform" header. Asserting through the constant keeps that explicit.
const CORRELATION_HEADER = HEADERS.CORRELATION_ID;

async function buildApp(
  opts: CorrelationIdPluginOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(createCorrelationIdPlugin(opts));

  app.get('/ok', async () => ({ ok: true }));

  // A route whose preHandler rejects — the case the per-service copies got
  // wrong: they set correlation headers inside the controller, which never
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
    expect(res.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
  });

  it('propagates an inbound correlation id rather than minting a new one', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [CORRELATION_HEADER]: 'inbound-correlation-id' },
    });

    expect(res.headers[CORRELATION_HEADER]).toBe('inbound-correlation-id');
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
    expect(res.headers[INTERACTION_HEADER]).toBe('interaction-abc');
    expect(res.headers[CORRELATION_HEADER]).toBe('interaction-abc');
  });

  it("adopts the caller's interaction id as the correlation id and echoes it back", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [INTERACTION_HEADER]: 'interaction-xyz' },
    });

    expect(res.headers[INTERACTION_HEADER]).toBe('interaction-xyz');
    expect(res.headers[CORRELATION_HEADER]).toBe('interaction-xyz');
  });

  it('falls back to a generated correlation id when no interaction id was sent', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/ok' });

    expect(res.headers[INTERACTION_HEADER]).toBeUndefined();
    // Nothing to echo, but the correlation header must never simply be absent.
    expect(res.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
  });

  it('can disable interaction-id handling for non-VASP-facing services', async () => {
    app = await buildApp({ interactionIdHeader: false });
    const res = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { [INTERACTION_HEADER]: 'interaction-xyz' },
    });

    // Neither echoed back nor adopted as the correlation id...
    expect(res.headers[INTERACTION_HEADER]).toBeUndefined();
    expect(res.headers[CORRELATION_HEADER]).not.toBe('interaction-xyz');
    // ...but the correlation id itself is never optional.
    expect(res.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
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
    expect(res.headers[CORRELATION_HEADER]).toEqual(expect.any(String));
    await outer.close();
  });
});
