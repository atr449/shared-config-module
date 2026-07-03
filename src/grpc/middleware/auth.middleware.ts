import type { Metadata, ServiceError } from '@grpc/grpc-js';
import * as jwt from 'jsonwebtoken';
import { HEADERS, MIDDLEWARE_MESSAGES } from '../../constants';
import { UnauthorizedException } from '../../exceptions';

/** JWTSECRET, matching the normalisation in src/env/baseEnvSchema.ts (some
 * services use JWT_SECRET instead of JWTSECRET). */
function getJwtSecret(): string | undefined {
  return process.env.JWTSECRET ?? process.env.JWT_SECRET;
}

export class GrpcAuthMiddleware {
  /** Validate gRPC metadata for a required, cryptographically valid auth token. */
  validateMetadata(metadata: Metadata): void {
    const token = metadata.get(HEADERS.API_ACCESS_TOKEN)[0] as
      string | undefined;
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException(MIDDLEWARE_MESSAGES.JWT_REQUIRED);
    }
    try {
      jwt.verify(token, getJwtSecret() ?? '');
    } catch {
      throw new UnauthorizedException(MIDDLEWARE_MESSAGES.INVALID_TOKEN);
    }
  }

  /** Map an error to a gRPC ServiceError (UNAUTHENTICATED). */
  handleAuthError(error: unknown): ServiceError {
    const unauthorized =
      error instanceof UnauthorizedException
        ? error
        : new UnauthorizedException(MIDDLEWARE_MESSAGES.AUTHENTICATION_FAILED);
    const serviceError = {
      name: MIDDLEWARE_MESSAGES.PERMISSION_DENIED,
      message: unauthorized.message,
      code: 16, // UNAUTHENTICATED
    } as ServiceError;
    return serviceError;
  }
}
