/**
 * Generic gRPC configuration shared by all services. Service-specific values
 * (hosts, proto paths, service names, message size from env) stay in each
 * service's own grpc config.
 */
export const DEFAULT_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
} as const;

export const SERVER_OPTIONS = {
  'grpc.keepalive_time_ms': 30000,
  'grpc.keepalive_timeout_ms': 5000,
  'grpc.keepalive_permit_without_calls': true,
  'grpc.http2.max_pings_without_data': 0,
  'grpc.http2.min_time_between_pings_ms': 10000,
  'grpc.http2.min_ping_interval_without_data_ms': 300000,
} as const;

export const GRPC_OPTIONS = {
  DEFAULT_OPTIONS,
  SERVER_OPTIONS,
} as const;

export const RETRY_CONFIG = {
  maxAttempts: 3,
  initialBackoff: '10s',
  maxBackoff: '50s',
  backoffMultiplier: 2,
  retryableStatusCodes: [
    'UNAVAILABLE',
    'DEADLINE_EXCEEDED',
    'RESOURCE_EXHAUSTED',
  ],
} as const;

export const GRPC_RETRY_TIMEOUT = '60s';

/** Default max message size (10MB) when a service doesn't override it. */
export const DEFAULT_MAX_MESSAGE_SIZE = 10485760;
