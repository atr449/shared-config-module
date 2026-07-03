import type { ServerUnaryCall } from '@grpc/grpc-js';
import * as jwt from 'jsonwebtoken';
import { HEADERS, LOG_LEVEL, MIDDLEWARE_MESSAGES } from '../../constants';
import { UnauthorizedException } from '../../exceptions';
import logger from '../../helpers/logger.helper';
import responseHelper from '../../helpers/response.helper';
import { GrpcHandler, GrpcInterceptor } from '../types';

/** JWTSECRET, matching the normalisation in src/env/baseEnvSchema.ts (some
 * services use JWT_SECRET instead of JWTSECRET). */
function getJwtSecret(): string | undefined {
  return process.env.JWTSECRET ?? process.env.JWT_SECRET;
}

export const authInterceptor: GrpcInterceptor = <Request, Response>(
  next: GrpcHandler<Request, Response>,
): GrpcHandler<Request, Response> => {
  return (call: ServerUnaryCall<Request, Response>, callback) => {
    try {
      const metadataMap = call.metadata?.getMap
        ? call.metadata.getMap()
        : ({} as Record<string, unknown>);
      const token = metadataMap[HEADERS.API_ACCESS_TOKEN] as string | undefined;
      if (!token) {
        throw new UnauthorizedException(MIDDLEWARE_MESSAGES.JWT_REQUIRED);
      }
      try {
        jwt.verify(token, getJwtSecret() ?? '');
      } catch {
        throw new UnauthorizedException(MIDDLEWARE_MESSAGES.INVALID_TOKEN);
      }
      return next(call, callback);
    } catch (error) {
      const unauthorized =
        error instanceof UnauthorizedException
          ? error
          : new UnauthorizedException(
              MIDDLEWARE_MESSAGES.AUTHENTICATION_FAILED,
            );
      logger.log(LOG_LEVEL.WARN, 'gRPC AUTH FAILED', {
        error: unauthorized.message,
      });
      const correlationId = call.metadata.get(HEADERS.CORRELATION_ID)?.[0] as
        string | undefined;
      const errorResponse = responseHelper.grpcError(
        unauthorized,
        correlationId,
      );
      callback(null, errorResponse as Response);
    }
  };
};
