import { resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import type {
  Server,
  ServerCredentials,
  ServiceDefinition,
  UntypedServiceImplementation,
} from '@grpc/grpc-js';
import { GRPC_OPTIONS, DEFAULT_MAX_MESSAGE_SIZE } from './config';
import logger from '../helpers/logger.helper';

function grpcLib(): typeof import('@grpc/grpc-js') {
  return require('@grpc/grpc-js');
}
function protoLoader(): typeof import('@grpc/proto-loader') {
  return require('@grpc/proto-loader');
}

function getServerCredentials(): ServerCredentials {
  const grpc = grpcLib();
  if (process.env.GRPC_TLS_ENABLED === 'true') {
    const key = Buffer.from(process.env.GRPC_TLS_KEY ?? '');
    const cert = Buffer.from(process.env.GRPC_TLS_CERT ?? '');
    return grpc.ServerCredentials.createSsl(null, [
      { private_key: key, cert_chain: cert },
    ]);
  }
  return grpc.ServerCredentials.createInsecure();
}

function resolveProtoPath(protoPath: string): string {
  // Absolute paths (e.g. from @fusionxglobal/fxg-service-model protoPath()) win outright.
  const candidates = isAbsolute(protoPath)
    ? [protoPath]
    : [
        resolve(process.cwd(), 'src', 'modules', 'grpc', protoPath),
        resolve(process.cwd(), 'dist', 'modules', 'grpc', protoPath),
        resolve(protoPath),
      ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`Proto file not found. Tried: ${candidates.join(', ')}`);
  }
  return found;
}

export interface GrpcServiceRegistration {
  /** Proto path relative to the service's grpc module (or absolute). */
  protoPath: string;
  /** Proto package name, e.g. 'AccountService'. */
  packageName: string;
  /** Service name within the package, e.g. 'AccountService'. */
  serviceName: string;
  /** Handler map (typically interceptor-wrapped via applyGrpcInterceptors). */
  implementation: UntypedServiceImplementation;
}

export interface CreateGrpcServerOptions {
  /** Bind address, e.g. '0.0.0.0:50051'. */
  host: string;
  /** One or more services to register on the server. */
  services: GrpcServiceRegistration[];
  maxReceiveMessageLength?: number;
  maxSendMessageLength?: number;
}

export interface GrpcServerHandle {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  getServer(): Server | null;
}

/**
 * Create a gRPC server with the shared scaffolding (message-size + keepalive
 * options, TLS-aware credentials, proto loading, idempotent start/shutdown).
 * The service supplies its host + the proto/handler registrations.
 */
export function createGrpcServer(
  options: CreateGrpcServerOptions,
): GrpcServerHandle {
  let server: Server | null = null;
  let isInitialized = false;
  let initializationPromise: Promise<void> | null = null;

  const initialize = async (): Promise<void> => {
    const grpc = grpcLib();
    const { loadSync } = protoLoader();
    server = new grpc.Server({
      grpc_max_receive_message_len:
        options.maxReceiveMessageLength ?? DEFAULT_MAX_MESSAGE_SIZE,
      grpc_max_send_message_len:
        options.maxSendMessageLength ?? DEFAULT_MAX_MESSAGE_SIZE,
    });

    for (const reg of options.services) {
      const protoPath = resolveProtoPath(reg.protoPath);
      const packageDefinition = loadSync(
        protoPath,
        GRPC_OPTIONS.DEFAULT_OPTIONS,
      );
      const packageDef = grpc.loadPackageDefinition(packageDefinition);
      const pkg = (packageDef as Record<string, unknown>)[reg.packageName] as
        | Record<
            string,
            { service: ServiceDefinition<UntypedServiceImplementation> }
          >
        | undefined;
      if (!pkg || !pkg[reg.serviceName]) {
        throw new Error(
          `${reg.packageName}.${reg.serviceName} not found in proto ${reg.protoPath}`,
        );
      }
      server.addService(pkg[reg.serviceName].service, reg.implementation);
      logger.info(`gRPC service registered: ${reg.serviceName}`);
    }

    await new Promise<void>((res, rej) => {
      server!.bindAsync(
        options.host,
        getServerCredentials(),
        (err: Error | null, port: number) => {
          if (err) {
            logger.error('FAILED TO BIND GRPC SERVER:', err);
            rej(err);
            return;
          }
          logger.info(`gRPC server bound to port ${port}`, {
            host: options.host,
            port,
          });
          isInitialized = true;
          res();
        },
      );
    });
  };

  return {
    async start(): Promise<void> {
      if (isInitialized) {
        logger.info('gRPC server already initialized');
        return;
      }
      if (initializationPromise) return initializationPromise;
      initializationPromise = initialize().catch((error) => {
        isInitialized = false;
        initializationPromise = null;
        logger.error('ERROR WHILE CREATING GRPC SERVER:', error);
        throw error;
      });
      await initializationPromise;
      initializationPromise = null;
    },
    async shutdown(): Promise<void> {
      if (!server || !isInitialized) return;
      await new Promise<void>((res) => {
        server!.forceShutdown();
        isInitialized = false;
        server = null;
        res();
      });
    },
    getServer(): Server | null {
      return server;
    },
  };
}
