import { createScopeResolver } from './scope-resolver.helper';
import type {
  ScopeResolverRedis,
  ScopeResolverAuthClient,
} from './scope-resolver.helper';
import { SCOPE_IDENTIFIERS, SCOPE_CATALOG_KEY } from '../constants/scopes';

jest.mock('./logger.helper', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

function makeRedis(
  overrides: Partial<ScopeResolverRedis> = {},
): jest.Mocked<ScopeResolverRedis> {
  return {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<ScopeResolverRedis>;
}

function makeAuthClient(
  overrides: Partial<ScopeResolverAuthClient> = {},
): jest.Mocked<ScopeResolverAuthClient> {
  return {
    getApiScopes: jest
      .fn()
      .mockResolvedValue({ success: true, scopeKey: 'beneficiary:create' }),
    ...overrides,
  } as jest.Mocked<ScopeResolverAuthClient>;
}

function build(redis = makeRedis(), authClient = makeAuthClient()) {
  return {
    redis,
    authClient,
    resolver: createScopeResolver({ redis, authClient, cacheTtlMinutes: 1440 }),
  };
}

describe('createScopeResolver', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('seedScopeIdentifiers', () => {
    it('writes the inverted identifier -> scopeKey catalog with the configured TTL', async () => {
      const { redis, resolver } = build();

      await resolver.seedScopeIdentifiers();

      expect(redis.setJson).toHaveBeenCalledTimes(1);
      const [key, catalog, ttlSeconds] = redis.setJson.mock.calls[0];
      expect(key).toBe(SCOPE_CATALOG_KEY);
      // Source map is scopeKey -> identifier; the cached catalog is inverted.
      expect((catalog as Record<string, string>).beneficiaryCreate).toBe(
        'beneficiary:create',
      );
      expect(Object.keys(catalog as object)).toHaveLength(
        Object.keys(SCOPE_IDENTIFIERS).length,
      );
      expect(ttlSeconds).toBe(1440 * 60);
    });

    it('does not throw when Redis is down — a service must still be able to start', async () => {
      const redis = makeRedis({
        setJson: jest.fn().mockRejectedValue(new Error('redis down')),
      });
      const { resolver } = build(redis);

      await expect(resolver.seedScopeIdentifiers()).resolves.toBeUndefined();
    });
  });

  describe('resolveScope', () => {
    it('returns the scope key from the Redis catalog without calling the auth service', async () => {
      const redis = makeRedis({
        getJson: jest
          .fn()
          .mockResolvedValue({ beneficiaryCreate: 'beneficiary:create' }),
      });
      const { authClient, resolver } = build(redis);

      await expect(resolver.resolveScope('beneficiaryCreate')).resolves.toBe(
        'beneficiary:create',
      );
      expect(authClient.getApiScopes).not.toHaveBeenCalled();
    });

    it('falls back to the auth service on a cache miss', async () => {
      const { authClient, resolver } = build();

      await expect(resolver.resolveScope('beneficiaryCreate')).resolves.toBe(
        'beneficiary:create',
      );
      expect(authClient.getApiScopes).toHaveBeenCalledWith({
        apiIdentifier: 'beneficiaryCreate',
      });
    });

    it('falls back to the auth service when the identifier is absent from a present catalog', async () => {
      const redis = makeRedis({
        getJson: jest.fn().mockResolvedValue({ somethingElse: 'a:b' }),
      });
      const { authClient, resolver } = build(redis);

      await expect(resolver.resolveScope('beneficiaryCreate')).resolves.toBe(
        'beneficiary:create',
      );
      expect(authClient.getApiScopes).toHaveBeenCalled();
    });

    // The security-critical cases: never resolve a scope we could not verify.
    it('fails closed (503) when Redis throws — never silently bypasses the scope check', async () => {
      const redis = makeRedis({
        getJson: jest.fn().mockRejectedValue(new Error('redis down')),
      });
      const { resolver } = build(redis);

      await expect(
        resolver.resolveScope('beneficiaryCreate'),
      ).rejects.toMatchObject({
        statusCode: 503,
      });
    });

    it('fails closed (503) when the auth service is unreachable', async () => {
      const authClient = makeAuthClient({
        getApiScopes: jest.fn().mockRejectedValue(new Error('grpc down')),
      });
      const { resolver } = build(makeRedis(), authClient);

      await expect(
        resolver.resolveScope('beneficiaryCreate'),
      ).rejects.toMatchObject({
        statusCode: 503,
      });
    });

    it.each([
      ['success: false', { success: false, scopeKey: 'beneficiary:create' }],
      ['missing scopeKey', { success: true }],
      ['empty response', undefined],
    ])(
      'throws 500 (a config problem, not a retryable outage) when the auth service answers with %s',
      async (_label, response) => {
        const authClient = makeAuthClient({
          getApiScopes: jest.fn().mockResolvedValue(response),
        });
        const { resolver } = build(makeRedis(), authClient);

        await expect(
          resolver.resolveScope('beneficiaryCreate'),
        ).rejects.toMatchObject({
          statusCode: 500,
        });
      },
    );

    it('includes the offending identifier in the unknown-identifier error', async () => {
      const authClient = makeAuthClient({
        getApiScopes: jest.fn().mockResolvedValue({ success: false }),
      });
      const { resolver } = build(makeRedis(), authClient);

      await expect(resolver.resolveScope('typoIdentifier')).rejects.toThrow(
        /typoIdentifier/,
      );
    });
  });

  describe('injected overrides', () => {
    it('uses a caller-supplied scope catalog instead of the platform default', async () => {
      const redis = makeRedis();
      const resolver = createScopeResolver({
        redis,
        authClient: makeAuthClient(),
        cacheTtlMinutes: 10,
        scopeIdentifiers: { 'custom:scope': 'customScope' },
      });

      await resolver.seedScopeIdentifiers();

      expect(redis.setJson.mock.calls[0][1]).toEqual({
        customScope: 'custom:scope',
      });
    });

    it('uses caller-supplied failure messages', async () => {
      const redis = makeRedis({
        getJson: jest.fn().mockRejectedValue(new Error('redis down')),
      });
      const resolver = createScopeResolver({
        redis,
        authClient: makeAuthClient(),
        cacheTtlMinutes: 10,
        messages: { scopeResolutionUnavailable: 'custom unavailable message' },
      });

      await expect(resolver.resolveScope('beneficiaryCreate')).rejects.toThrow(
        'custom unavailable message',
      );
    });
  });
});
