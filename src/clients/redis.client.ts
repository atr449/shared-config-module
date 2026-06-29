import Redis, { Cluster } from 'ioredis';
import { REDIS_MODE } from '../constants';
import logger from '../helpers/logger.helper';

export interface RedisClientConfig {
  host: string;
  /** Read-replica host. Falls back to `host` when omitted. */
  readHost?: string;
  port: number;
  /** Password (ioredis `password`). */
  auth?: string;
  /** Username (ioredis `username`). */
  user?: string;
  /** `single` (default) or `cluster`. See {@link REDIS_MODE}. */
  mode?: string;
  /** Enable TLS. Defaults to env REDIS_TLS (which itself defaults to true). */
  tls?: boolean;
  /** Skip cert verification. Defaults to env REDIS_TLS_INSECURE (default true). */
  tlsInsecure?: boolean;
}

/**
 * Redis client with lazy connections (write + read replica), automatic
 * reconnection, structured logging and a small set of convenience helpers
 * (string/json get-set, distributed lock). The connection is only established
 * when a method is first called.
 *
 * Instantiate once per service with the service's resolved Redis config:
 *
 *   export default createRedisClient({ host, readHost, port, auth, user, mode });
 */
export class RedisClient {
  private client: Redis | Cluster | null = null;
  private isConnecting = false;
  private connectionPromise: Promise<void> | null = null;

  private readClient: Redis | Cluster | null = null;
  private isReadConnecting = false;
  private readConnectionPromise: Promise<void> | null = null;

  private readonly host: string;
  private readonly readHost: string;
  private readonly port: number;
  private readonly auth?: string;
  private readonly user?: string;
  private readonly mode: string;
  private readonly tls: boolean;
  private readonly tlsInsecure: boolean;

  constructor(config: RedisClientConfig) {
    this.host = config.host;
    this.readHost = config.readHost || config.host;
    this.port = config.port;
    this.auth = config.auth;
    this.user = config.user;
    this.mode = config.mode || REDIS_MODE.SINGLE;
    this.tls =
      config.tls ?? (process.env.REDIS_TLS ?? 'true') === 'true';
    this.tlsInsecure =
      config.tlsInsecure ?? (process.env.REDIS_TLS_INSECURE ?? 'true') === 'true';
  }

  private async ensureConnection(): Promise<void> {
    if (this.client && this.client.status === 'ready') return;
    if (this.isConnecting && this.connectionPromise) {
      return await this.connectionPromise;
    }
    this.isConnecting = true;
    this.connectionPromise = this.connect(this.host, false);
    try {
      await this.connectionPromise;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  private async ensureReadConnection(): Promise<void> {
    if (this.readClient && this.readClient.status === 'ready') return;
    if (this.isReadConnecting && this.readConnectionPromise) {
      return await this.readConnectionPromise;
    }
    this.isReadConnecting = true;
    this.readConnectionPromise = this.connect(this.readHost, true);
    try {
      await this.readConnectionPromise;
    } finally {
      this.isReadConnecting = false;
      this.readConnectionPromise = null;
    }
  }

  private async connect(host: string, isRead: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        logger.info(
          `Initializing Redis ${isRead ? 'read' : 'write'} connection`,
          { host, port: this.port },
        );

        const commonOptions = {
          password: this.auth,
          username: this.user,
          enableReadyCheck: false,
          maxRetriesPerRequest: null,
          lazyConnect: true,
        } as const;

        let newClient: Redis | Cluster;

        if (this.mode === REDIS_MODE.CLUSTER) {
          newClient = new Redis.Cluster([{ host, port: this.port }], {
            redisOptions: {
              ...commonOptions,
              tls: { rejectUnauthorized: false },
            },
          });
        } else {
          newClient = new Redis({
            host,
            port: this.port,
            ...(this.tls && {
              tls: {
                ...(this.tlsInsecure && { rejectUnauthorized: false }),
              },
            }),
            ...commonOptions,
            retryStrategy: (times: number) => {
              const delay = Math.min(times * 50, 2000);
              logger.warn(
                `Redis ${isRead ? 'read' : 'write'} retry attempt ${times}, waiting ${delay}ms`,
              );
              return delay;
            },
          });
        }

        newClient.on('connect', () => {
          logger.info(
            `Redis ${isRead ? 'read' : 'write'} connected successfully`,
            { host, port: this.port },
          );
          resolve();
        });
        newClient.on('ready', () => {
          logger.info(`Redis ${isRead ? 'read' : 'write'} ready to accept commands`);
        });
        newClient.on('error', (error: Error) => {
          logger.error(`Redis ${isRead ? 'read' : 'write'} connection error`, {
            error: error.message,
            stack: error.stack,
          });
        });
        newClient.on('close', () => {
          logger.warn(`Redis ${isRead ? 'read' : 'write'} connection closed`);
        });
        newClient.on('reconnecting', () => {
          logger.info(`Redis ${isRead ? 'read' : 'write'} reconnecting...`);
        });

        newClient.connect().catch((error: Error) => {
          logger.error(`Redis ${isRead ? 'read' : 'write'} connection failed`, {
            error: error.message,
          });
          reject(error);
        });

        if (isRead) {
          this.readClient = newClient;
        } else {
          this.client = newClient;
        }
      } catch (error) {
        logger.error(
          `Failed to create Redis ${isRead ? 'read' : 'write'} client`,
          { error: error instanceof Error ? error.message : 'Unknown error' },
        );
        reject(error);
      }
    });
  }

  public isConnected(): boolean {
    return this.client !== null && this.client.status === 'ready';
  }

  public getStatus(): string {
    return this.client?.status || 'not_initialized';
  }

  public async getClient(): Promise<Redis> {
    await this.ensureConnection();
    if (!this.client) {
      throw new Error('Redis client not available after connection attempt');
    }
    return this.client as unknown as Redis;
  }

  public async getReadClient(): Promise<Redis> {
    await this.ensureReadConnection();
    if (!this.readClient) {
      throw new Error('Redis read client not available after connection attempt');
    }
    return this.readClient as unknown as Redis;
  }

  public getClientSync(): Redis | null {
    return this.client && this.client.status === 'ready'
      ? (this.client as unknown as Redis)
      : null;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      logger.info('Redis write client disconnected');
    }
    if (this.readClient) {
      await this.readClient.quit();
      this.readClient = null;
      logger.info('Redis read client disconnected');
    }
  }

  /** Set string value. `expires` is in MINUTES (converted to seconds). */
  public async setString(
    key: string,
    value: string,
    expires = 0,
    database = '',
  ): Promise<string | null> {
    try {
      await this.ensureConnection();
      if (!this.client) throw new Error('Redis client not available');
      if (database !== '') await this.client.select(parseInt(database));
      if (expires !== 0) {
        return await this.client.setex(key, expires * 60, value);
      }
      return await this.client.set(key, value);
    } catch (error) {
      logger.error('Error while setting string in Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      throw error;
    }
  }

  public async getString(key: string, database = ''): Promise<string | null> {
    try {
      await this.ensureConnection();
      if (!this.client) throw new Error('Redis client not available');
      if (database !== '') await this.client.select(parseInt(database));
      return await this.client.get(key);
    } catch (error) {
      logger.error('Error while getting string from Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      throw error;
    }
  }

  /** Get string from the read replica — use on read-heavy paths. */
  public async getStringRead(
    key: string,
    database = '',
  ): Promise<string | null> {
    try {
      await this.ensureReadConnection();
      if (!this.readClient) throw new Error('Redis read client not available');
      if (database !== '') await this.readClient.select(parseInt(database));
      return await this.readClient.get(key);
    } catch (error) {
      logger.error('Error while getting string from Redis read replica', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      throw error;
    }
  }

  public async destroyDb(dbKey: string): Promise<boolean> {
    try {
      await this.ensureConnection();
      if (!this.client) throw new Error('Redis client not available');
      const response = await this.client.del(dbKey);
      return response === 1;
    } catch (error) {
      logger.error('Error deleting key from Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key: dbKey,
      });
      throw error;
    }
  }

  public async setJson(
    key: string,
    value: object,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.ensureConnection();
      if (!this.client) throw new Error('Redis client not available');
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      logger.error('Error setting JSON in Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      throw error;
    }
  }

  public async getJson<T = object>(key: string): Promise<T | null> {
    try {
      await this.ensureConnection();
      if (!this.client) throw new Error('Redis client not available');
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      logger.error('Error getting JSON from Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        key,
      });
      throw error;
    }
  }

  public async acquireLock(
    lockKey: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    try {
      await this.ensureConnection();
      if (!this.client) throw new Error('Redis client not available');
      const result = await this.client.set(
        lockKey,
        token,
        'EX',
        ttlSeconds,
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      logger.error('Error acquiring Redis lock', {
        error: error instanceof Error ? error.message : 'Unknown error',
        lockKey,
      });
      throw error;
    }
  }

  public async releaseLock(lockKey: string, token: string): Promise<void> {
    try {
      await this.ensureConnection();
      if (!this.client) throw new Error('Redis client not available');
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.client.eval(luaScript, 1, lockKey, token);
    } catch (error) {
      logger.error('Error releasing Redis lock', {
        error: error instanceof Error ? error.message : 'Unknown error',
        lockKey,
      });
    }
  }
}

/** Convenience factory — create a configured (but not yet connected) client. */
export function createRedisClient(config: RedisClientConfig): RedisClient {
  return new RedisClient(config);
}
