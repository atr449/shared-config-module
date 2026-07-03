import type { ServerUnaryCall } from '@grpc/grpc-js';
import { ZodError, ZodType } from 'zod';
import { HEADERS } from '../../constants';
import { ValidationException } from '../../exceptions';
import responseHelper from '../../helpers/response.helper';
import { GrpcHandler, GrpcInterceptor } from '../types';

/**
 * Validate a gRPC request against a Zod schema BEFORE the handler runs.
 * On success the (transformed) data replaces call.request.
 */
export function validateGrpcRequest<T extends ZodType>(
  schema: T,
): GrpcInterceptor {
  return <Request, Response>(
    next: GrpcHandler<Request, Response>,
  ): GrpcHandler<Request, Response> => {
    return (call: ServerUnaryCall<Request, Response>, callback) => {
      try {
        const parsed = schema.parse(call.request);
        (call as { request: unknown }).request = parsed;
        return next(call, callback);
      } catch (error) {
        if (error instanceof ZodError) {
          const correlationId = call.metadata.get(
            HEADERS.CORRELATION_ID,
          )?.[0] as string | undefined;
          const validationErrors = error.issues.map((err) => ({
            field: err.path.join('.') || 'unknown',
            message: err.message,
          }));
          const validationException = new ValidationException(validationErrors);
          const errorResponse = responseHelper.grpcError(
            validationException,
            correlationId,
          );
          return callback(null, errorResponse as Response);
        }
        throw error;
      }
    };
  };
}
