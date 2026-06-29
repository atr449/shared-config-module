export const LOG_LEVEL = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
} as const;

export const ENVIRONMENT = {
  PROD: 'prod',
  STAGE: 'stage',
  DEV: 'dev',
  QA: 'qa',
  UAT: 'uat',
  LOCAL: 'local',
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
} as const;

export const REDIS_MODE = {
  SINGLE: 'single',
  CLUSTER: 'cluster',
} as const;

/** gRPC / dependency client lifecycle state. */
export const CLIENT_STATE = {
  READY: 'READY',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
} as const;

export const PAGINATION = {
  LIMIT_VALUE: 10,
  OFFSET_VALUE: 0,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
  MIN_PAGE: 1,
} as const;
