import type { sendUnaryData } from '@grpc/grpc-js';
import { LoggingMiddleware } from '../middleware/logging.middleware';
import { HEADERS, LOG_LEVEL, GRPC_MESSAGES } from '../../constants';
import { responseHelper, asyncLocalStorage } from '../../helpers';
import logger from '../../helpers/logger.helper';
import { BadRequestException } from '../../exceptions';
import {
  GrpcHandler,
  GrpcInterceptor,
  CallWithCorrelationId,
  GrpcResponse,
} from '../types';

/**
 * Logging interceptor: requires correlationId, sets the ALS context, logs
 * request start/end with timing, and standardised error levels.
 */
export const loggingInterceptor: GrpcInterceptor = <Request, Response>(
  next: GrpcHandler<Request, Response>,
): GrpcHandler<Request, Response> => {
  return (call, callback) => {
    const startTime = process.hrtime.bigint();
    const methodName = call.getPath();
    const metadataMap = call.metadata?.getMap
      ? call.metadata.getMap()
      : ({} as Record<string, unknown>);
    const correlationId = metadataMap[HEADERS.CORRELATION_ID] as string;

    if (!correlationId || correlationId.trim() === '') {
      const error = new BadRequestException(
        GRPC_MESSAGES.ERROR.MISSING_CORRELATION_ID,
      );
      logger.error('gRPC REQUEST MISSING CORRELATION ID', {
        method: methodName,
        metadata: metadataMap,
        error: error.errors,
      });
      callback(null, responseHelper.grpcError(error, undefined) as Response);
      return;
    }

    asyncLocalStorage.run({ correlationId }, () => {
      const callWithContext = call as CallWithCorrelationId;
      callWithContext.correlationId = correlationId;
      const clientIp = LoggingMiddleware.getClientIp(call);

      logger.info('gRPC REQUEST START', {
        method: methodName,
        path: methodName,
        ip: clientIp,
        clientIp,
        request: call.request,
      });

      const wrappedCallback: sendUnaryData<unknown> = (error, response) => {
        const endTime = process.hrtime.bigint();
        const durationMs = Number((endTime - startTime) / BigInt(1000000));
        const durationFormatted =
          durationMs < 1000
            ? `${durationMs}ms`
            : `${(durationMs / 1000).toFixed(2)}s`;
        const grpcResponse = response as GrpcResponse | undefined;
        const isError = error !== null || grpcResponse?.error === true;
        const statusCode = grpcResponse?.status;
        const isServerError = statusCode !== undefined && statusCode >= 500;
        const logLevel = isServerError
          ? LOG_LEVEL.ERROR
          : isError
            ? LOG_LEVEL.WARN
            : LOG_LEVEL.INFO;

        const logData: Record<string, unknown> = {
          method: methodName,
          path: methodName,
          statusCode,
          status: statusCode,
          duration: durationFormatted,
          durationMs,
          clientIp,
          ip: clientIp,
        };
        if (isError && grpcResponse?.data) logData.response = grpcResponse.data;
        if (durationMs > 5000) logData.performanceWarning = 'SLOW_REQUEST';

        logger[logLevel]('gRPC REQUEST END', logData);
        callback(error as Error, response as Response);
      };

      return next(call, wrappedCallback);
    });
  };
};
