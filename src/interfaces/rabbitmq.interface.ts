import { ExchangeType } from '../constants';

/**
 * RabbitMQ Connection Configuration
 */
export interface RabbitMQConfig {
  url: string;
  connectionName?: string;
  heartbeat?: number;
  prefetch?: number;
}

/**
 * Connection state enum
 */
export enum ConnectionState {
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR',
}

/**
 * Options used when consuming from a queue
 */
export interface ConsumerQueueOptions {
  durable?: boolean;
  prefetch?: number;
  noAck?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
}

/**
 * Message info from RabbitMQ
 */
export interface MessageInfo {
  fields?: unknown;
  properties?: unknown;
  content?: Buffer;
}

/**
 * Consumer configuration
 */
export interface ConsumeQueueConfig {
  queueName: string;
  exchangeName?: string;
  routingKey?: string;
  onMessage: (message: unknown, messageInfo?: MessageInfo) => Promise<void>;
  options?: ConsumerQueueOptions;
}

/**
 * Options used when publishing to an exchange
 */
export interface PublishExchangeOptions {
  persistent?: boolean;
  durable?: boolean;
  priority?: number;
  headers?: Record<string, unknown>;
}

/**
 * Publish to exchange configuration
 */
export interface PublishToExchangeConfig {
  exchangeName: string;
  exchangeType?: ExchangeType;
  routingKey: string;
  message: unknown;
  options?: PublishExchangeOptions;
}

/**
 * Options used when publishing directly to a queue
 */
export interface PublishQueueOptions {
  persistent?: boolean;
  durable?: boolean;
  expiration?: string;
  priority?: number;
}

/**
 * Publish to queue configuration
 */
export interface PublishToQueueConfig {
  queueName: string;
  message: unknown;
  options?: PublishQueueOptions;
}

/**
 * Retry configuration for asserting queues
 */
export interface QueueRetryConfig {
  maxRetries: number;
  retryDelayMs: number;
  backoffStrategy: 'exponential' | 'linear';
  maxDelayMs: number;
  jitterMs: number;
}

/**
 * Options used when asserting a queue
 */
export interface QueueAssertionOptions {
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  exchangeName?: string;
  exchangeType?: 'direct' | 'topic' | 'fanout' | 'headers';
  routingKeys?: string[]; // For multiple bindings
  retryConfig?: QueueRetryConfig;
}

/**
 * Queue configuration for batch assertion
 */
export interface QueueSetupConfig {
  queueName: string;
  exchangeName: string;
  exchangeType: ExchangeType;
  routingKeys: string[];
  retryConfig: QueueRetryConfig;
  durable: boolean;
  exclusive: boolean;
  autoDelete: boolean;
}

/**
 * Options used when asserting an exchange
 */
export interface ExchangeAssertionOptions {
  exchangeType?: ExchangeType;
  durable?: boolean;
}

/**
 * Exchange configuration for batch assertion
 */
export interface ExchangeConfig {
  name: string;
  exchangeType: ExchangeType;
  durable: boolean;
}

/**
 * RabbitMQ Publisher interface
 */
export interface RabbitMQPublisher {
  publishToQueue(config: PublishToQueueConfig): Promise<boolean>;
  publishToExchange(config: PublishToExchangeConfig): Promise<boolean>;
  assertQueues(
    queueName: string,
    options: QueueAssertionOptions,
  ): Promise<void>;
}

/**
 * RabbitMQ Consumer interface
 */
export interface RabbitMQConsumer {
  consumeQueue(config: ConsumeQueueConfig): Promise<void>;
}

/**
 * RabbitMQ Helper interface
 */
export interface RabbitMQHelper {
  getPublisher(): RabbitMQPublisher;
  getConsumer(): RabbitMQConsumer;
  getConnectionState(): ConnectionState;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}
