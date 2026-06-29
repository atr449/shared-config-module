/** AMQP exchange types. */
export type ExchangeType = 'direct' | 'topic' | 'fanout' | 'headers';

export const EXCHANGE_TYPE = {
  DIRECT: 'direct',
  TOPIC: 'topic',
  FANOUT: 'fanout',
  HEADERS: 'headers',
} as const;

/** Sensible defaults for queue declaration. */
export const DEFAULT_QUEUE_OPTIONS = {
  durable: true,
  exclusive: false,
  autoDelete: false,
} as const;

/** Sensible defaults for consumers. */
export const DEFAULT_CONSUMER_OPTIONS = {
  prefetch: 1,
} as const;

/** Default retry/back-off policy for queue assertion + message processing. */
export const DEFAULT_RETRY_CONFIG = {
  maxRetries: 5,
  retryDelayMs: 2000,
  backoffStrategy: 'exponential' as const,
  maxDelayMs: 300000,
  jitterMs: 1000,
};
