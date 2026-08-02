import Fastify, { FastifyInstance } from 'fastify';
import { createRequestLoggerPlugin } from './requestLogger.plugin';
import logger from '../helpers/logger.helper';

jest.mock('../helpers/logger.helper', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));

const mockLogger = logger as unknown as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

function findLog(mock: jest.Mock, message: string): Record<string, unknown> | undefined {
  const call = mock.mock.calls.find(([msg]) => msg === message);
  return call?.[1] as Record<string, unknown> | undefined;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(createRequestLoggerPlugin());

  app.get('/ok', async () => ({ ok: true }));
  app.post('/echo', async (req) => req.body as object);
  app.get('/health/ready', async () => ({ status: 'ok' }));
  app.get('/boom', async (_req, reply) => reply.status(500).send({ bad: true }));

  await app.ready();
  return app;
}

describe('createRequestLoggerPlugin', () => {
  let app: FastifyInstance;

  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => {
    if (app) await app.close();
  });

  it('logs REQUEST START and REQUEST END for a normal request', async () => {
    app = await buildApp();
    await app.inject({ method: 'GET', url: '/ok' });

    expect(findLog(mockLogger.info, 'REQUEST START')).toBeDefined();
    const end = findLog(mockLogger.info, 'REQUEST END');
    expect(end).toMatchObject({ method: 'GET', statusCode: 200 });
    expect(end?.durationMs).toEqual(expect.any(Number));
  });

  it('masks sensitive headers rather than logging them raw', async () => {
    app = await buildApp();
    await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { authorization: 'Bearer super-secret-token' },
    });

    const start = findLog(mockLogger.info, 'REQUEST START');
    const headers = start?.headers as Record<string, string>;
    expect(headers.authorization).toBeDefined();
    expect(headers.authorization).not.toContain('super-secret-token');
  });

  it('redacts sensitive fields in the request body', async () => {
    app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { username: 'alice', password: 'hunter2' },
    });

    const start = findLog(mockLogger.info, 'REQUEST START');
    expect(JSON.stringify(start?.body)).not.toContain('hunter2');
  });

  it('logs 5xx at error level and includes the response body', async () => {
    app = await buildApp();
    await app.inject({ method: 'GET', url: '/boom' });

    const end = findLog(mockLogger.error, 'REQUEST END');
    expect(end).toMatchObject({ statusCode: 500 });
    expect(end?.response).toBeDefined();
  });

  it('stays quiet for excluded paths while healthy', async () => {
    app = await buildApp();
    await app.inject({ method: 'GET', url: '/health/ready' });

    expect(findLog(mockLogger.info, 'REQUEST START')).toBeUndefined();
    expect(findLog(mockLogger.info, 'REQUEST END')).toBeUndefined();
  });

  it('flags slow requests past the configured threshold', async () => {
    const slowApp = Fastify();
    // Threshold of 0 makes every request "slow" — asserts the tagging works
    // without making the test wait.
    await slowApp.register(createRequestLoggerPlugin({ slowRequestMs: 0 }));
    slowApp.get('/ok', async () => ({ ok: true }));
    await slowApp.ready();

    await slowApp.inject({ method: 'GET', url: '/ok' });

    expect(findLog(mockLogger.info, 'REQUEST END')?.performanceWarning).toBe(
      'SLOW_REQUEST',
    );
    await slowApp.close();
  });
});
