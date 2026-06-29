import {
  initializeRabbitMQ,
  publisher as packagePublisher,
  consumer as packageConsumer,
} from 'rabbitmq-with-retry-and-dlq';
import { context as otelContext, propagation } from '@opentelemetry/api';
import { ENVIRONMENT, ExchangeType } from '../constants';
import logger from '../helpers/logger.helper';
import {
  asyncLocalStorage,
  RequestContext,
} from '../helpers/asyncLocalStorage.helper';
import {
  ConnectionState,
  RabbitMQHelper,
  RabbitMQPublisher,
  RabbitMQConsumer,
  PublishToQueueConfig,
  PublishToExchangeConfig,
  ConsumeQueueConfig,
  QueueAssertionOptions,
  QueueSetupConfig,
  ExchangeConfig,
  MessageInfo,
} from '../interfaces/rabbitmq.interface';

export interface RabbitMQClientConfig {
  /** AMQP connection URL. */
  url: string;
  /** Exchanges to assert on initialization. */
  exchanges?: ExchangeConfig[];
  /** Queues to assert/bind on initialization. */
  queues?: QueueSetupConfig[];
  /** Current NODE_ENV — used for the prod TLS guard. */
  nodeEnv?: string;
  /** Require `amqps://` in production (default `true`). */
  enforceTlsInProd?: boolean;
}

/**
 * Inject OTel trace context + correlation id into an outgoing message so the
 * consuming service can continue the trace.
 */
function injectOtelContext<T extends { message: unknown }>(config: T): T {
  const carrier: Record<string, string> = {};
  propagation.inject(otelContext.active(), carrier);
  const store = asyncLocalStorage.getStore();
  const original = (config.message as Record<string, unknown>) ?? {};
  return {
    ...config,
    message: {
      ...original,
      traceparent: carrier['traceparent'] ?? '',
      tracestate: carrier['tracestate'] ?? '',
      correlationId:
        original['correlationId'] || store?.correlationId || '',
    },
  };
}

/**
 * RabbitMQ client with lazy connection + automatic exchange/queue assertion.
 * Wraps `rabbitmq-with-retry-and-dlq`, adds OTel context propagation on both
 * publish (inject) and consume (extract + ALS), and structured logging.
 */
export class RabbitMQClient implements RabbitMQHelper {
  private connectionState: ConnectionState = ConnectionState.NOT_INITIALIZED;
  private initializationPromise: Promise<void> | null = null;
  private isInitialized = false;

  private readonly url: string;
  private readonly exchanges: ExchangeConfig[];
  private readonly queues: QueueSetupConfig[];

  constructor(config: RabbitMQClientConfig) {
    this.url = config.url || 'amqp://localhost';
    this.exchanges = config.exchanges ?? [];
    this.queues = config.queues ?? [];

    const nodeEnv = config.nodeEnv || process.env.NODE_ENV || ENVIRONMENT.LOCAL;
    const enforceTls = config.enforceTlsInProd ?? true;
    const isProd = (
      [ENVIRONMENT.PROD, ENVIRONMENT.PRODUCTION] as string[]
    ).includes(nodeEnv);
    if (enforceTls && isProd && !this.url.startsWith('amqps://')) {
      throw new Error('RABBITMQ_URL must use amqps:// (TLS) in production');
    }
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  public isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED;
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.performInitialization();
    return this.initializationPromise;
  }

  private async performInitialization(): Promise<void> {
    try {
      this.connectionState = ConnectionState.CONNECTING;
      await initializeRabbitMQ(this.url);
      this.connectionState = ConnectionState.CONNECTED;
      await this.assertAllExchanges();
      await this.setupAllQueues();
      this.isInitialized = true;
    } catch (error) {
      this.connectionState = ConnectionState.ERROR;
      this.initializationPromise = null; // allow retry
      logger.error('Failed to initialize RabbitMQ:', error);
      throw new Error(
        `RabbitMQ initialization failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  private async assertAllExchanges(): Promise<void> {
    logger.debug('Asserting RabbitMQ exchanges', {
      count: this.exchanges.length,
    });
    await Promise.all(
      this.exchanges.map(async (exchangeConfig) => {
        try {
          await packageConsumer.assertExchange(exchangeConfig.name, {
            exchangeType: exchangeConfig.exchangeType as ExchangeType,
            durable: exchangeConfig.durable,
          });
          logger.info(
            `Exchange asserted: ${exchangeConfig.name} (type: ${exchangeConfig.exchangeType})`,
          );
        } catch (error) {
          logger.error(`Failed to assert exchange: ${exchangeConfig.name}`, error);
          throw error;
        }
      }),
    );
    logger.info('All exchanges asserted successfully');
  }

  private async setupAllQueues(): Promise<void> {
    await Promise.all(
      this.queues.map(async (queueConfig) => {
        try {
          await packageConsumer.setupQueue(queueConfig);
          logger.info(`Queue asserted: ${queueConfig.queueName}`);
        } catch (error) {
          logger.error(`Failed to assert queue: ${queueConfig.queueName}`, error);
          throw error;
        }
      }),
    );
    logger.info('All queues asserted successfully');
  }

  public getPublisher(): RabbitMQPublisher {
    return {
      publishToQueue: async (
        config: PublishToQueueConfig,
      ): Promise<boolean> => {
        await this.initialize();
        return packagePublisher.publishToQueue(injectOtelContext(config));
      },
      publishToExchange: async (
        config: PublishToExchangeConfig,
      ): Promise<boolean> => {
        await this.initialize();
        return packagePublisher.publishToExchange(injectOtelContext(config));
      },
      assertQueues: async (
        queueName: string,
        options: QueueAssertionOptions,
      ): Promise<void> => {
        await this.initialize();
        return packageConsumer.assertQueues(queueName, options);
      },
    };
  }

  public getConsumer(): RabbitMQConsumer {
    return {
      consumeQueue: async (config: ConsumeQueueConfig): Promise<void> => {
        await this.initialize();

        const wrappedOnMessage = async (
          message: unknown,
          messageInfo?: unknown,
        ): Promise<void> => {
          const msgObj =
            message && typeof message === 'object'
              ? (message as Record<string, unknown>)
              : {};
          const carrier: Record<string, string> = {};
          if (msgObj['traceparent'])
            carrier['traceparent'] = msgObj['traceparent'] as string;
          if (msgObj['tracestate'])
            carrier['tracestate'] = msgObj['tracestate'] as string;
          const parentCtx = propagation.extract(otelContext.active(), carrier);
          const correlationId = (msgObj['correlationId'] as string) || '';
          const alsContext: RequestContext = { correlationId };

          await otelContext.with(parentCtx, () =>
            asyncLocalStorage.run(alsContext, () =>
              config.onMessage(
                message as MessageInfo,
                messageInfo as MessageInfo,
              ),
            ),
          );
        };

        return packageConsumer.consumeQueue({
          queueName: config.queueName,
          onMessage: wrappedOnMessage,
          options: config.options,
        });
      },
    };
  }

  public async disconnect(): Promise<void> {
    if (this.connectionState === ConnectionState.CONNECTED) {
      try {
        logger.debug('Disconnecting from RabbitMQ...');
        this.connectionState = ConnectionState.DISCONNECTED;
        this.isInitialized = false;
        this.initializationPromise = null;
        logger.debug('Disconnected from RabbitMQ');
      } catch (error) {
        logger.error('Error disconnecting from RabbitMQ:', error);
        throw error;
      }
    }
  }
}

export interface RabbitMQClientBundle {
  helper: RabbitMQClient;
  /** Lazy proxy — initialises the connection on first publish. */
  publisher: RabbitMQPublisher;
  /** Lazy proxy — initialises the connection on first consume. */
  consumer: RabbitMQConsumer;
}

/**
 * Create a RabbitMQ client plus lazy publisher/consumer proxies.
 *
 *   const { publisher, consumer, helper } = createRabbitMQClient({
 *     url: RABBITMQ_URL, exchanges: EXCHANGE_CONFIGURATION, queues: ASSERTION_CONFIG,
 *   });
 */
export function createRabbitMQClient(
  config: RabbitMQClientConfig,
): RabbitMQClientBundle {
  const helper = new RabbitMQClient(config);

  const publisher: RabbitMQPublisher = new Proxy({} as RabbitMQPublisher, {
    get(_target, prop): unknown {
      const pub = helper.getPublisher();
      return (pub as unknown as Record<string, unknown>)[prop as string];
    },
  });

  const consumer: RabbitMQConsumer = new Proxy({} as RabbitMQConsumer, {
    get(_target, prop): unknown {
      const cons = helper.getConsumer();
      return (cons as unknown as Record<string, unknown>)[prop as string];
    },
  });

  return { helper, publisher, consumer };
}
