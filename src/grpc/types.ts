import type { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';

/** A gRPC request that may carry a correlation id (set by the logging interceptor). */
export interface CallWithCorrelationId extends ServerUnaryCall<
  unknown,
  unknown
> {
  correlationId?: string;
}

export interface GrpcResponse {
  error?: boolean;
  status?: number;
  data?: unknown;
  message?: string;
}

/** A gRPC unary method handler. */
export type GrpcHandler<Request = unknown, Response = unknown> = (
  call: ServerUnaryCall<Request, Response>,
  callback: sendUnaryData<Response>,
) => void | Promise<void>;

/** An interceptor that wraps a handler with extra behaviour. */
export type GrpcInterceptor = <Request, Response>(
  next: GrpcHandler<Request, Response>,
) => GrpcHandler<Request, Response>;
