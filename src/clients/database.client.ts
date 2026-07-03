import * as fs from 'fs';
import * as path from 'path';
// Type-only import is erased at compile time, so `sequelize` (an OPTIONAL
// peer) is required lazily inside createDatabase() — importing this module
// never pulls the SDK unless createDatabase() is actually called.
import type { Sequelize as SequelizeType, Dialect, Options } from 'sequelize';
import { ENVIRONMENT } from '../constants';
import logger from '../helpers/logger.helper';
import { requireOptionalPeer } from '../helpers/optionalPeer.helper';

export interface DatabaseConfig {
  dbName: string;
  username: string;
  password: string;
  host: string;
  /** Read-replica host. Falls back to `host`. */
  readHost?: string;
  port: number;
  dialect?: Dialect;
  ssl?: boolean;
  sslRejectUnauthorized?: boolean;
  /** Path to a CA bundle (absolute or relative to cwd). */
  sslCaPath?: string;
  timezone?: string;
  /** Current NODE_ENV — used to size the connection pool. */
  nodeEnv?: string;
}

export interface DatabaseClient {
  /** The configured Sequelize instance — import this into your models. */
  sequelize: SequelizeType;
  /** Authenticate + mark initialised. Call during startup after env load. */
  initializeDatabase: () => Promise<void>;
  /** Close all pooled connections (graceful shutdown). */
  closeDatabase: () => Promise<void>;
  /** Readiness probe — authenticate against the DB. */
  isDatabaseHealthy: () => Promise<boolean>;
  /** Whether {@link DatabaseClient.initializeDatabase} has completed. */
  isDatabaseInitialized: () => boolean;
}

/**
 * Create a configured Sequelize instance plus its lifecycle helpers.
 *
 * The instance is created eagerly (so the `Model.init({ sequelize })` pattern
 * works at import time), but no connection is opened until
 * `initializeDatabase()` runs. Pool sizing, SSL/CA handling, retry policy and
 * dialect options match the previous per-service `sequelize.helper`.
 */
export function createDatabase(config: DatabaseConfig): DatabaseClient {
  const nodeEnv = config.nodeEnv || process.env.NODE_ENV || ENVIRONMENT.LOCAL;
  const dialect = (config.dialect || 'postgres') as Dialect;
  const port = config.port || 5432;
  const isProduction =
    nodeEnv === ENVIRONMENT.PROD || nodeEnv === ENVIRONMENT.PRODUCTION;

  const poolConfig = {
    max: isProduction ? 20 : 10,
    min: isProduction ? 5 : 2,
    acquire: 30000,
    idle: 10000,
    evict: 1000,
  };

  const getDialectOptions = (): Options['dialectOptions'] => {
    const baseOptions = {
      dateStrings: true,
      typeCast: true,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 10000,
    };

    if (config.ssl) {
      const ssl: {
        require: boolean;
        rejectUnauthorized: boolean;
        ca?: string | Buffer;
      } = {
        require: true,
        rejectUnauthorized: !!config.sslRejectUnauthorized,
      };
      const caPath = config.sslCaPath;
      if (caPath) {
        const resolved = path.isAbsolute(caPath)
          ? caPath
          : path.resolve(process.cwd(), caPath);
        try {
          if (fs.existsSync(resolved)) {
            ssl.ca = fs.readFileSync(resolved);
          } else {
            logger.warn('DB_SSL_CA_PATH is set but file was not found', {
              path: resolved,
            });
          }
        } catch (err) {
          logger.warn('Failed to read DB_SSL_CA_PATH', {
            path: resolved,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (config.sslRejectUnauthorized) {
        logger.warn(
          'DB_SSL_REJECT_UNAUTHORIZED is true but DB_SSL_CA_PATH is empty; RDS connections may fail unless the host trust store includes the RDS CA',
        );
      }
      return { ...baseOptions, ssl };
    }

    return baseOptions;
  };

  const { Sequelize } = requireOptionalPeer<typeof import('sequelize')>(
    'sequelize',
    'Database client',
  );
  const sequelize: SequelizeType = new Sequelize({
    database: config.dbName || 'placeholder_db',
    username: config.username || 'placeholder_user',
    password: config.password || '',
    dialect,
    replication: {
      write: { host: config.host || 'localhost', port },
      read: [{ host: config.readHost || config.host || 'localhost', port }],
    },
    pool: poolConfig,
    logging: false,
    define: {
      timestamps: true,
      freezeTableName: true,
    },
    dialectOptions: getDialectOptions(),
    timezone: config.timezone || '+00:00',
    retry: {
      max: 3,
      match: [
        /SequelizeConnectionError/,
        /SequelizeConnectionRefusedError/,
        /SequelizeHostNotFoundError/,
        /SequelizeHostNotReachableError/,
        /SequelizeInvalidConnectionError/,
        /SequelizeConnectionTimedOutError/,
        /ETIMEDOUT/,
        /ECONNRESET/,
        /ECONNREFUSED/,
      ],
    },
  });

  let isInitialized = false;

  const validateRequiredConfig = (): void => {
    const required: Record<string, string | undefined> = {
      DBNAME: config.dbName,
      USER_NAME: config.username,
      PASSWORD: config.password,
      HOST_NAME: config.host,
    };
    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(
        `Missing required database configuration: ${missing.join(', ')}`,
      );
    }
  };

  const initializeDatabase = async (): Promise<void> => {
    if (isInitialized) {
      logger.warn('Database already initialized, skipping...');
      return;
    }
    validateRequiredConfig();
    try {
      await sequelize.authenticate();
      isInitialized = true;
      logger.info('Database connection established successfully', {
        host: config.host,
        database: config.dbName,
        dialect,
        port,
      });
    } catch (error) {
      logger.error('Unable to connect to the database', {
        error: error instanceof Error ? error.message : 'Unknown error',
        host: config.host,
        database: config.dbName,
      });
      throw error;
    }
  };

  const closeDatabase = async (): Promise<void> => {
    try {
      await sequelize.close();
      isInitialized = false;
      logger.info('Database connections closed gracefully');
    } catch (error) {
      logger.error('Error closing database connections', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  };

  const isDatabaseHealthy = async (): Promise<boolean> => {
    if (!isInitialized) return false;
    try {
      await sequelize.authenticate();
      return true;
    } catch {
      return false;
    }
  };

  const isDatabaseInitialized = (): boolean => isInitialized;

  return {
    sequelize,
    initializeDatabase,
    closeDatabase,
    isDatabaseHealthy,
    isDatabaseInitialized,
  };
}
