import { Request, Response, NextFunction, RequestHandler } from 'express';
import * as crypto from 'crypto';
import { IDEMPOTENCY_RECORD_STATUS, IDEMPOTENCY_MESSAGES } from '../constants';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '../exceptions';
import logger from '../helpers/logger.helper';
import {
  validateIdempotencyKey,
  normalizePath,
  canonicalizeAndHash,
  buildRedisKey,
  buildLockKey,
} from '../helpers/idempotency.helper';

/** Minimal Redis surface the middleware needs — satisfied by RedisClient. */
export interface IdempotencyRedis {
  getJson<T = object>(key: string): Promise<T | null>;
  setJson(key: string, value: object, ttlSeconds: number): Promise<void>;
  acquireLock(
    lockKey: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  releaseLock(lockKey: string, token: string): Promise<void>;
}

/** Shape of one idempotency record instance (a Sequelize model instance). */
export interface IdempotencyRecordInstance {
  id: string;
  requestHash: string;
  status: string;
  responseCode: number | null;
  responseBody: object | null;
  createdAt: Date;
  update(values: Record<string, unknown>): Promise<unknown>;
}

/** Minimal Sequelize model surface the middleware needs. */
export interface IdempotencyModel {
  findOne(options: {
    where: Record<string, unknown>;
  }): Promise<IdempotencyRecordInstance | null>;
  findByPk(id: string): Promise<IdempotencyRecordInstance | null>;
  create(values: Record<string, unknown>): Promise<IdempotencyRecordInstance>;
}

export interface IdempotencyMiddlewareConfig {
  /** Redis client (the shared RedisClient instance). */
  redis: IdempotencyRedis;
  /** The service's IdempotencyRecord Sequelize model. */
  model: IdempotencyModel;
  /** Per-service key namespace (e.g. 'accounts-service'). */
  keyPrefix: string;
  /** Extract the partition/owner key from the request. Default: req.effectiveVaspId. */
  getOwnerKey?: (req: Request) => string;
  lockTtlSeconds?: number;
  lockWaitTimeoutMs?: number;
  lockPollIntervalMs?: number;
  processingWaitTimeoutMs?: number;
  processingPollIntervalMs?: number;
  successRedisTtlSeconds?: number;
  failedRedisTtlSeconds?: number;
}

interface CachedIdempotencyEntry {
  requestHash: string;
  responseCode: number;
  responseBody: object;
  createdAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build a distributed, replay-safe idempotency middleware.
 *
 * Extracted from the per-service copies (which had drifted) so the concurrency
 * logic guarding against duplicate writes/double-spends lives in one place.
 * The service injects its Redis client, its IdempotencyRecord model and the
 * key namespace; everything else is shared.
 */
export function createIdempotencyMiddleware(
  config: IdempotencyMiddlewareConfig,
): RequestHandler {
  const { redis, model, keyPrefix } = config;
  const getOwnerKey =
    config.getOwnerKey ??
    ((req: Request) =>
      (req as Request & { effectiveVaspId?: string }).effectiveVaspId ?? '');

  const LOCK_TTL_SECONDS = config.lockTtlSeconds ?? 90;
  const LOCK_WAIT_TIMEOUT_MS = config.lockWaitTimeoutMs ?? 60_000;
  const LOCK_POLL_INTERVAL_MS = config.lockPollIntervalMs ?? 500;
  const PROCESSING_WAIT_TIMEOUT_MS = config.processingWaitTimeoutMs ?? 30_000;
  const PROCESSING_POLL_INTERVAL_MS = config.processingPollIntervalMs ?? 500;
  const SUCCESS_REDIS_TTL_SECONDS =
    config.successRedisTtlSeconds ?? 24 * 60 * 60;
  const FAILED_REDIS_TTL_SECONDS = config.failedRedisTtlSeconds ?? 60 * 60;

  function replayRecord(
    res: Response,
    record: IdempotencyRecordInstance,
  ): void {
    res.setHeader('Idempotency-Replay', 'true');
    res.setHeader('Idempotency-Key-Created-At', record.createdAt.toISOString());
    res.status(record.responseCode!).json(record.responseBody);
  }

  async function finalizeRecord(
    record: IdempotencyRecordInstance,
    statusCode: number,
    body: { message?: string } | null,
    requestHash: string,
    redisKey: string,
    lockKey: string,
    lockToken: string,
  ): Promise<void> {
    const isSuccess = statusCode >= 200 && statusCode < 300;

    // 5xx/infra failures are NOT durably cached as a terminal outcome — a
    // transient blip (a downstream timeout, a DB hiccup) would otherwise be
    // replayed verbatim to every retry for up to FAILED_REDIS_TTL_SECONDS
    // (or indefinitely in Postgres). Leave the record in PROCESSING instead:
    // once LOCK_TTL_SECONDS elapses it's picked up as stale and reclaimed
    // (see Step 2/4 above), so the caller can simply retry shortly after.
    if (statusCode >= 500) {
      logger.warn(
        '[IDEMPOTENCY] Non-2xx (5xx) response — not caching as a terminal failure, leaving record for retry',
        { recordId: record.id, statusCode },
      );
      await redis.releaseLock(lockKey, lockToken);
      return;
    }

    try {
      await record.update(
        isSuccess
          ? {
              status: IDEMPOTENCY_RECORD_STATUS.SUCCESS,
              responseCode: statusCode,
              responseBody: body,
              completedAt: new Date(),
            }
          : {
              status: IDEMPOTENCY_RECORD_STATUS.FAILED,
              responseCode: statusCode,
              responseBody: body,
              errorMessage: body?.message ?? 'Request failed',
              completedAt: new Date(),
            },
      );

      try {
        const ttl = isSuccess
          ? SUCCESS_REDIS_TTL_SECONDS
          : FAILED_REDIS_TTL_SECONDS;
        await redis.setJson(
          redisKey,
          {
            requestHash,
            responseCode: statusCode,
            responseBody: body,
            createdAt: record.createdAt.toISOString(),
          } as CachedIdempotencyEntry,
          ttl,
        );
      } catch {
        // Non-fatal — PostgreSQL is source of truth.
      }
    } catch (updateErr) {
      logger.error('[IDEMPOTENCY] Failed to finalize idempotency record', {
        recordId: record.id,
        statusCode,
        error: updateErr instanceof Error ? updateErr.message : 'Unknown error',
      });
    } finally {
      await redis.releaseLock(lockKey, lockToken);
    }
  }

  return async function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const rawKey = req.headers['x-idempotency-key'] as string | undefined;

    if (!rawKey) {
      return next(new BadRequestException(IDEMPOTENCY_MESSAGES.KEY_REQUIRED));
    }
    if (!validateIdempotencyKey(rawKey)) {
      return next(
        new BadRequestException(IDEMPOTENCY_MESSAGES.KEY_INVALID_FORMAT),
      );
    }

    const ownerKey = getOwnerKey(req);
    const method = req.method.toUpperCase();
    const normalizedPath = normalizePath(req.path);
    const requestHash = canonicalizeAndHash(req.body ?? {});
    const redisKey = buildRedisKey(
      keyPrefix,
      ownerKey,
      method,
      normalizedPath,
      rawKey,
    );
    const lockKey = buildLockKey(
      keyPrefix,
      ownerKey,
      method,
      normalizedPath,
      rawKey,
    );
    const correlationId = (req as Request & { correlationId?: string })
      .correlationId;

    // ── Step 1: Redis replay check (fail-open on Redis error) ──
    try {
      const cached = await redis.getJson<CachedIdempotencyEntry>(redisKey);
      if (cached) {
        if (cached.requestHash !== requestHash) {
          return next(new ConflictException(IDEMPOTENCY_MESSAGES.KEY_REUSED));
        }
        logger.info('[IDEMPOTENCY] Redis cache hit — replaying response', {
          ownerKey,
          rawKey,
          correlationId,
        });
        res.setHeader('Idempotency-Replay', 'true');
        res.setHeader('Idempotency-Key-Created-At', cached.createdAt);
        res.status(cached.responseCode).json(cached.responseBody);
        return;
      }
    } catch {
      logger.warn(
        '[IDEMPOTENCY] Redis read failed — falling through to PostgreSQL',
        { ownerKey, rawKey, correlationId },
      );
    }

    // ── Step 2: PostgreSQL check ──
    const existingRecord = await model.findOne({
      where: {
        vaspId: ownerKey,
        method,
        apiPathNormalized: normalizedPath,
        idempotencyKey: rawKey,
      },
    });

    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) {
        return next(new ConflictException(IDEMPOTENCY_MESSAGES.KEY_REUSED));
      }

      if (
        (existingRecord.status === IDEMPOTENCY_RECORD_STATUS.SUCCESS ||
          existingRecord.status === IDEMPOTENCY_RECORD_STATUS.FAILED) &&
        existingRecord.responseBody
      ) {
        try {
          const ttl =
            existingRecord.status === IDEMPOTENCY_RECORD_STATUS.SUCCESS
              ? SUCCESS_REDIS_TTL_SECONDS
              : FAILED_REDIS_TTL_SECONDS;
          await redis.setJson(
            redisKey,
            {
              requestHash: existingRecord.requestHash,
              responseCode: existingRecord.responseCode!,
              responseBody: existingRecord.responseBody,
              createdAt: existingRecord.createdAt.toISOString(),
            } as CachedIdempotencyEntry,
            ttl,
          );
        } catch {
          // Non-fatal
        }
        logger.info('[IDEMPOTENCY] PostgreSQL hit — replaying response', {
          ownerKey,
          rawKey,
          correlationId,
        });
        replayRecord(res, existingRecord);
        return;
      }

      if (existingRecord.status === IDEMPOTENCY_RECORD_STATUS.PROCESSING) {
        const isStale =
          Date.now() - existingRecord.createdAt.getTime() >
          LOCK_TTL_SECONDS * 1000;

        if (!isStale) {
          logger.info(
            '[IDEMPOTENCY] Request in-flight — polling for completion',
            { ownerKey, rawKey, correlationId, recordId: existingRecord.id },
          );
          const deadline = Date.now() + PROCESSING_WAIT_TIMEOUT_MS;
          while (Date.now() < deadline) {
            await sleep(PROCESSING_POLL_INTERVAL_MS);
            const refreshed = await model.findByPk(existingRecord.id);
            if (
              refreshed &&
              refreshed.status !== IDEMPOTENCY_RECORD_STATUS.PROCESSING &&
              refreshed.responseBody
            ) {
              replayRecord(res, refreshed);
              return;
            }
          }
          return next(
            new ConflictException(
              IDEMPOTENCY_MESSAGES.REQUEST_ALREADY_PROCESSING,
            ),
          );
        }

        // Stale PROCESSING record: the owning request died (crash/OOM/deploy)
        // before it could finalize — its Redis lock (at most LOCK_TTL_SECONDS
        // old) has already expired. Don't block the caller forever; fall
        // through to acquire the lock and reclaim this record.
        logger.warn(
          '[IDEMPOTENCY] Found stale PROCESSING record — reclaiming it',
          { ownerKey, rawKey, correlationId, recordId: existingRecord.id },
        );
      }
    }

    // ── Step 3: Acquire distributed lock (fail-closed) ──
    const lockToken = crypto.randomUUID();
    let lockAcquired = false;
    try {
      const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        lockAcquired = await redis.acquireLock(
          lockKey,
          lockToken,
          LOCK_TTL_SECONDS,
        );
        if (lockAcquired) break;
        await sleep(LOCK_POLL_INTERVAL_MS);
      }
    } catch {
      return next(
        new ServiceUnavailableException(
          IDEMPOTENCY_MESSAGES.LOCK_SERVICE_UNAVAILABLE,
        ),
      );
    }

    if (!lockAcquired) {
      return next(
        new ConflictException(IDEMPOTENCY_MESSAGES.REQUEST_ALREADY_PROCESSING),
      );
    }

    // ── Step 4: Double-check PostgreSQL after acquiring lock ──
    const doubleCheck = await model.findOne({
      where: {
        vaspId: ownerKey,
        method,
        apiPathNormalized: normalizedPath,
        idempotencyKey: rawKey,
      },
    });

    let record: IdempotencyRecordInstance | undefined;

    if (doubleCheck) {
      if (
        (doubleCheck.status === IDEMPOTENCY_RECORD_STATUS.SUCCESS ||
          doubleCheck.status === IDEMPOTENCY_RECORD_STATUS.FAILED) &&
        doubleCheck.responseBody
      ) {
        await redis.releaseLock(lockKey, lockToken);
        replayRecord(res, doubleCheck);
        return;
      }
      if (doubleCheck.status === IDEMPOTENCY_RECORD_STATUS.PROCESSING) {
        const stillStale =
          Date.now() - doubleCheck.createdAt.getTime() >
          LOCK_TTL_SECONDS * 1000;

        if (!stillStale) {
          await redis.releaseLock(lockKey, lockToken);
          return next(
            new ConflictException(
              IDEMPOTENCY_MESSAGES.REQUEST_ALREADY_PROCESSING,
            ),
          );
        }

        // Reclaim the stale record under our lock instead of creating a
        // second row (which would violate the unique key on this request).
        await doubleCheck.update({
          status: IDEMPOTENCY_RECORD_STATUS.PROCESSING,
          correlationId,
          createdAt: new Date(),
        });
        record = doubleCheck;
      }
    }

    // ── Step 5: Create PROCESSING record (unless one was just reclaimed) ──
    if (!record) {
      try {
        record = await model.create({
          vaspId: ownerKey,
          idempotencyKey: rawKey,
          requestHash,
          apiPathNormalized: normalizedPath,
          method,
          status: IDEMPOTENCY_RECORD_STATUS.PROCESSING,
          correlationId,
          responseCode: null,
          responseBody: null,
          errorMessage: null,
          completedAt: null,
          reapedAt: null,
        });
      } catch (createErr) {
        // Duck-typed rather than `instanceof UniqueConstraintError` so this
        // module never needs to import `sequelize` (an OPTIONAL peer) at all.
        if (
          createErr instanceof Error &&
          createErr.name === 'SequelizeUniqueConstraintError'
        ) {
          await redis.releaseLock(lockKey, lockToken);
          const raced = await model.findOne({
            where: {
              vaspId: ownerKey,
              method,
              apiPathNormalized: normalizedPath,
              idempotencyKey: rawKey,
            },
          });
          if (raced && raced.requestHash !== requestHash) {
            return next(new ConflictException(IDEMPOTENCY_MESSAGES.KEY_REUSED));
          }
          if (raced?.responseBody) {
            replayRecord(res, raced);
            return;
          }
          return next(
            new ConflictException(
              IDEMPOTENCY_MESSAGES.REQUEST_ALREADY_PROCESSING,
            ),
          );
        }
        await redis.releaseLock(lockKey, lockToken);
        return next(createErr as Error);
      }
    }

    (
      req as Request & {
        idempotencyCtx?: {
          recordId: string;
          lockKey: string;
          lockToken: string;
          redisKey: string;
        };
      }
    ).idempotencyCtx = { recordId: record.id, lockKey, lockToken, redisKey };

    // ── Step 6: Capture response and finalize via res.on('finish') ──
    let capturedBody: { message?: string } | null = null;
    const originalJson = res.json.bind(res);
    res.json = function (body: { message?: string }): Response {
      capturedBody = body;
      return originalJson(body);
    };

    res.once('finish', () => {
      setImmediate(() => {
        void finalizeRecord(
          record,
          res.statusCode,
          capturedBody,
          requestHash,
          redisKey,
          lockKey,
          lockToken,
        );
      });
    });

    next();
  };
}
