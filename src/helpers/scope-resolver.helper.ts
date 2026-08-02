import logger from './logger.helper';
import {
  SCOPE_IDENTIFIERS,
  SCOPE_CATALOG_KEY,
  SCOPE_MESSAGES,
} from '../constants/scopes';
import {
  ServiceUnavailableException,
  InternalServerException,
} from '../exceptions/http';

/** identifier (e.g. 'beneficiaryCreate') -> scope key (e.g. 'beneficiary:create'). */
export type ScopeCatalog = Record<string, string>;

/**
 * Minimal structural shape of the Redis client this needs. Declared
 * structurally rather than importing the concrete `RedisClient` so a service
 * can pass its own instance (or a stub, in tests) without this module
 * dictating how Redis is constructed.
 */
export interface ScopeResolverRedis {
  getJson<T = object>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/** Minimal shape of the authentication service's gRPC client. */
export interface ScopeResolverAuthClient {
  getApiScopes(request: { apiIdentifier: string }): Promise<{
    success?: boolean;
    scopeKey?: string;
  }>;
}

export interface ScopeResolverDeps {
  redis: ScopeResolverRedis;
  authClient: ScopeResolverAuthClient;
  /** How long the seeded catalog lives in Redis. */
  cacheTtlMinutes: number;
  /** Override the catalog (tests, or a service with an extended scope set). */
  scopeIdentifiers?: Record<string, string>;
  /** Override the default failure messages. */
  messages?: {
    scopeResolutionUnavailable?: string;
    unknownScopeIdentifier?: string;
  };
}

export interface ScopeResolver {
  seedScopeIdentifiers(): Promise<void>;
  resolveScope(identifier: string): Promise<string>;
}

/**
 * Builds the scope resolver for a service.
 *
 * Previously copied into 7 services with byte-identical logic (only the
 * comment examples differed), which meant every fix had to be made 7 times —
 * this is security-critical code deciding whether a token's scope grants
 * access to a route, so a missed copy is a real authorization gap.
 *
 * Redis and the authentication gRPC client are injected rather than imported
 * because they are per-service instances (different hosts, pools and configs);
 * only the *logic* is shared.
 *
 * @example
 *   export const { seedScopeIdentifiers, resolveScope } = createScopeResolver({
 *     redis: redisClient,
 *     authClient: authenticationClient,
 *     cacheTtlMinutes: config.SCOPE_CATALOG.CACHE_TTL_MINUTES,
 *   });
 */
export function createScopeResolver(deps: ScopeResolverDeps): ScopeResolver {
  const {
    redis,
    authClient,
    cacheTtlMinutes,
    scopeIdentifiers = SCOPE_IDENTIFIERS,
    messages = {},
  } = deps;

  const unavailableMessage =
    messages.scopeResolutionUnavailable ??
    SCOPE_MESSAGES.SCOPE_RESOLUTION_UNAVAILABLE;
  const unknownIdentifierMessage =
    messages.unknownScopeIdentifier ?? SCOPE_MESSAGES.UNKNOWN_SCOPE_IDENTIFIER;

  /**
   * Seeds Redis with the full identifier -> scope catalog known locally, so
   * the common case (resolveScope) is a pure Redis read. Call once at service
   * startup; safe to call repeatedly (idempotent overwrite).
   *
   * Failures are logged, not thrown: a service that cannot seed must still
   * start, because resolveScope falls back to the authentication service.
   */
  async function seedScopeIdentifiers(): Promise<void> {
    try {
      const catalog: ScopeCatalog = {};
      for (const [scopeKey, identifier] of Object.entries(scopeIdentifiers)) {
        catalog[identifier] = scopeKey;
      }
      await redis.setJson(SCOPE_CATALOG_KEY, catalog, cacheTtlMinutes * 60);
    } catch (error) {
      logger.error('scopeResolver:seedScopeIdentifiers', { error });
    }
  }

  /**
   * Resolves a route's scope identifier (e.g. 'beneficiaryCreate') to the
   * actual scope key to check against the token (e.g. 'beneficiary:create').
   * Redis-first (seeded by seedScopeIdentifiers, or by a prior gRPC fallback),
   * falling back to the authentication service over gRPC on a cache miss.
   *
   * Fails closed if both are unreachable, so a Redis blip can never silently
   * bypass the scope check.
   */
  async function resolveScope(identifier: string): Promise<string> {
    let catalog: ScopeCatalog | null;
    try {
      catalog = await redis.getJson<ScopeCatalog>(SCOPE_CATALOG_KEY);
    } catch (error) {
      logger.error('scopeResolver:getJson', { identifier, error });
      throw new ServiceUnavailableException(unavailableMessage);
    }

    if (catalog && catalog[identifier]) {
      return catalog[identifier];
    }

    let response;
    try {
      response = await authClient.getApiScopes({ apiIdentifier: identifier });
    } catch (error) {
      logger.error('scopeResolver:getApiScopes', { identifier, error });
      throw new ServiceUnavailableException(unavailableMessage);
    }

    if (!response || !response.success || !response.scopeKey) {
      // The authentication service is reachable and answered — it just has no
      // scope registered for this identifier. That's a configuration problem
      // (a typo in ROUTE_SCOPE_MAP, or a scope removed centrally), not a
      // transient outage, so this isn't retryable like the errors above.
      throw new InternalServerException(
        `${unknownIdentifierMessage}: '${identifier}'`,
      );
    }

    return response.scopeKey;
  }

  return { seedScopeIdentifiers, resolveScope };
}
