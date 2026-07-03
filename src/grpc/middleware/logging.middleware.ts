import type { ServerUnaryCall } from '@grpc/grpc-js';
import logger from '../../helpers/logger.helper';

export class LoggingMiddleware {
  static logError(error: Error, context: string): void {
    logger.error(`gRPC Error in ${context}:`, {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }

  static getClientIp(call: ServerUnaryCall<unknown, unknown>): string {
    const metadata = call.metadata;
    const xForwardedFor = metadata.get('x-forwarded-for');
    const xRealIp = metadata.get('x-real-ip');
    if (xForwardedFor && xForwardedFor.length > 0) {
      return xForwardedFor[0] as string;
    }
    if (xRealIp && xRealIp.length > 0) {
      return xRealIp[0] as string;
    }
    return 'unknown';
  }
}
