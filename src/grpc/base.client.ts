import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import type {
  ChannelCredentials,
  Client,
  Metadata as MetadataType,
  ServiceError,
} from '@grpc/grpc-js';
import { GRPC_OPTIONS, RETRY_CONFIG, GRPC_RETRY_TIMEOUT } from './config';
import { CLIENT_STATE, GRPC_MESSAGES, HEADERS } from '../constants';
import { BadRequestException } from '../exceptions';
import logger from '../helpers/logger.helper';
import { getCorrelationIdFromStore } from './interceptors/utils';

// `@grpc/grpc-js` + `@grpc/proto-loader` are OPTIONAL peers, required lazily so
// importing this module never pulls them unless a gRPC client is used.
function grpcLib(): typeof import('@grpc/grpc-js') {
  return require('@grpc/grpc-js');
}
function protoLoader(): typeof import('@grpc/proto-loader') {
  return require('@grpc/proto-loader');
}

function getChannelCredentials(): ChannelCredentials {
  const grpc = grpcLib();
  if (process.env.GRPC_TLS_ENABLED === 'true') {
    return grpc.ChannelCredentials.createSsl();
  }
  return grpc.ChannelCredentials.createInsecure();
}

/**
 * Abstract base for gRPC clients. Concrete clients pass their service name,
 * host and proto path; this base handles lazy connection, proto loading,
 * retry policy, correlation-id propagation, metadata and logging.
 */
export abstract class BaseClient {
  protected client: Client | null = null;
  protected serviceName: string;
  protected host: string;
  protected protoPath: string;
  private initializationPromise: Promise<void> | null = null;

  constructor(serviceName: string, host: string, protoPath: string) {
    this.serviceName = serviceName;
    this.host = host;
    this.protoPath = protoPath;
  }

  protected async ensureClientInitialized(): Promise<void> {
    if (this.client) return;
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.initializeClient();
    await this.initializationPromise;
  }

  private async initializeClient(): Promise<void> {
    try {
      if (!this.host || !this.protoPath || !this.serviceName) {
        throw new Error(
          `gRPC configuration is missing for ${this.serviceName}. Required: host, protoPath, serviceName`,
        );
      }

      // An absolute path wins outright — this is the path produced by
      // `protoPath('account')` from @fusionxglobal/fxg-service-model (the contract package)
      // or `require.resolve('@fusionxglobal/fxg-service-model/account.proto')`.
      // Otherwise fall back to a service-local proto under src|dist/modules/grpc.
      const candidates = isAbsolute(this.protoPath)
        ? [this.protoPath]
        : [
            resolve(process.cwd(), 'src', 'modules', 'grpc', this.protoPath),
            resolve(process.cwd(), 'dist', 'modules', 'grpc', this.protoPath),
            resolve(this.protoPath),
            resolve(__dirname, '..', '..', '..', this.protoPath),
          ];
      const fullProtoPath = candidates.find((p) => existsSync(p));
      if (!fullProtoPath) {
        throw new Error(
          `Proto file not found for ${this.serviceName}. Tried: ${candidates.join(', ')}`,
        );
      }

      const { loadSync } = protoLoader();
      const grpc = grpcLib();
      const packageDefinition = loadSync(
        fullProtoPath,
        GRPC_OPTIONS.DEFAULT_OPTIONS,
      );
      const packageDef = grpc.loadPackageDefinition(packageDefinition);

      const packageObj = packageDef[this.serviceName] as
        | Record<
            string,
            new (
              address: string,
              credentials: ChannelCredentials,
              options?: Record<string, unknown>,
            ) => Client
          >
        | undefined;
      if (!packageObj || typeof packageObj !== 'object') {
        throw new Error(
          `${GRPC_MESSAGES.ERROR.SERVICE_NOT_FOUND}: Package ${this.serviceName} not found in proto definition`,
        );
      }

      const ServiceConstructor = packageObj[this.serviceName];
      if (!ServiceConstructor || typeof ServiceConstructor !== 'function') {
        throw new Error(
          `${GRPC_MESSAGES.ERROR.SERVICE_NOT_FOUND}: Service constructor ${this.serviceName}.${this.serviceName} not found or invalid`,
        );
      }

      const fullServiceName = `${this.serviceName}.${this.serviceName}`;
      const serviceConfig = {
        methodConfig: [
          {
            name: [{ service: fullServiceName }],
            retryPolicy: RETRY_CONFIG,
            timeout: GRPC_RETRY_TIMEOUT,
          },
        ],
      };
      const channelOptions = {
        'grpc.service_config': JSON.stringify(serviceConfig),
        'grpc.enable_retries': 1,
      };

      this.client = new ServiceConstructor(
        this.host,
        getChannelCredentials(),
        channelOptions,
      );

      logger.info(
        `${this.serviceName} gRPC client initialized with lazy loading`,
        { host: this.host, serviceName: this.serviceName, fullServiceName },
      );
    } catch (error) {
      logger.error(`Failed to initialize ${this.serviceName} gRPC client`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        serviceName: this.serviceName,
        host: this.host,
      });
      this.initializationPromise = null;
      throw error;
    }
  }

  protected async callService<T>(
    methodName: string,
    request: unknown,
    timeout = 5000,
  ): Promise<T> {
    const startTime = Date.now();
    const vaspId = (request as { vaspId?: string })?.vaspId;

    await this.ensureClientInitialized();
    if (!this.client) {
      throw new Error(
        `${GRPC_MESSAGES.ERROR.CLIENT_NOT_INITIALIZED}: ${this.serviceName}`,
      );
    }

    const grpc = grpcLib();
    const correlationId = getCorrelationIdFromStore();
    let metadata: MetadataType | undefined;
    if (correlationId) {
      metadata = new grpc.Metadata();
      metadata.set(HEADERS.CORRELATION_ID, correlationId);
    }

    return new Promise<T>((resolvePromise, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + timeout / 1000);

      const callback = (err: ServiceError | null, response?: T): void => {
        const duration = Date.now() - startTime;
        if (
          err ||
          (response &&
            typeof response === 'object' &&
            'error' in response &&
            (response as { error?: unknown }).error)
        ) {
          logger.error(
            `[gRPC Client] ${this.serviceName}.${methodName} failed`,
            {
              serviceName: this.serviceName,
              methodName,
              vaspId,
              duration,
              error: err instanceof Error ? err.message : 'Unknown error',
              stack: err instanceof Error ? err.stack : undefined,
            },
          );
          reject(new BadRequestException(GRPC_MESSAGES.ERROR.INTERNAL_ERROR));
        } else {
          logger.info(
            `[gRPC Client] ${this.serviceName}.${methodName} completed successfully`,
            { serviceName: this.serviceName, methodName, vaspId, duration },
          );
          resolvePromise(response as T);
        }
      };

      type GrpcClientMethod = (
        request: unknown,
        metadataOrOptions?: MetadataType | Record<string, unknown>,
        optionsOrCallback?:
          | Record<string, unknown>
          | ((err: ServiceError | null, response?: T) => void),
        callback?: (err: ServiceError | null, response?: T) => void,
      ) => void;
      const clientWithMethods = this.client as Client & {
        [method: string]: GrpcClientMethod;
      };

      if (metadata) {
        clientWithMethods[methodName](
          request,
          metadata,
          { deadline },
          callback,
        );
      } else {
        clientWithMethods[methodName](request, { deadline }, callback);
      }
    });
  }

  /** Build gRPC metadata with optional correlationId + auth token. */
  protected createMetadata(params: {
    correlationId?: string;
    token?: string;
  }): MetadataType {
    const grpc = grpcLib();
    const metadata = new grpc.Metadata();
    if (params.correlationId) {
      metadata.set(HEADERS.CORRELATION_ID, params.correlationId);
    }
    if (params.token) {
      metadata.set(HEADERS.API_ACCESS_TOKEN, params.token);
    }
    return metadata;
  }

  public isConnected(): boolean {
    return this.client !== null;
  }

  public getClientState(): string {
    return this.client ? CLIENT_STATE.READY : CLIENT_STATE.NOT_INITIALIZED;
  }
}
