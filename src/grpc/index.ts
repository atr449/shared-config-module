/**
 * @fusionxglobal/shared-config/grpc
 *
 * Shared gRPC framework: interceptors, server middleware, the BaseClient
 * abstract class, generic config and a createGrpcServer() helper. Services
 * keep their own proto files, concrete clients and handlers and import this
 * framework. `@grpc/grpc-js` + `@grpc/proto-loader` are optional peers,
 * lazily loaded.
 */
export * from './types';
export * from './config';
export * from './middleware';
export {
  applyGrpcInterceptors,
  getCorrelationIdFromStore,
  loggingInterceptor,
  authInterceptor,
  validateGrpcRequest,
} from './interceptors';
export { BaseClient } from './base.client';
export { createGrpcServer } from './server';
export type {
  GrpcServiceRegistration,
  CreateGrpcServerOptions,
  GrpcServerHandle,
} from './server';
