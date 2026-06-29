import { Response } from 'express';
import { BaseHttpException, InternalServerException } from '../exceptions';
import { COMMON_MESSAGES, HTTP_STATUS_CODES, ErrorType } from '../constants';
import {
  SuccessBody,
  ErrorBody,
  BaseErrorResponse,
  GrpcSuccessBody,
} from '../interfaces/responses.interface';

export class ResponseHelper {
  public success(
    response: Response,
    data: { message: string; data?: unknown; statusCode?: number },
    correlationId?: string,
  ): Response {
    const body: SuccessBody = {
      success: true,
      message: data.message,
      data: typeof data.data !== 'undefined' ? data.data : [],
      statusCode: data.statusCode ?? HTTP_STATUS_CODES.OK,
      timestamp: new Date().toISOString(),
    };
    if (correlationId) {
      body.correlationId = correlationId;
    }
    return response.status(body.statusCode).json(body);
  }

  public error(
    response: Response,
    err: unknown,
    correlationId?: string,
    path?: string,
  ): Response {
    const timestamp = new Date().toISOString();
    const baseResponse: BaseErrorResponse = {
      success: false,
      timestamp,
    };
    if (correlationId) {
      baseResponse.correlationId = correlationId;
    }
    if (err instanceof BaseHttpException) {
      const errorResponse: ErrorBody = {
        ...baseResponse,
        message: err.message,
        errorType: err.errorType,
        statusCode: err.statusCode,
      };

      if (path) {
        errorResponse.path = path;
      }

      // Add errors array only for validation errors
      if (
        err.errorType === ErrorType.VALIDATION_ERROR &&
        err.errors &&
        err.errors.length > 0
      ) {
        errorResponse.errors = err.errors;
      }

      return response.status(errorResponse.statusCode).json(errorResponse);
    }

    const internal = new InternalServerException(COMMON_MESSAGES.ERROR);
    const errorResponse: ErrorBody = {
      ...baseResponse,
      message: internal.message,
      errorType: internal.errorType,
      statusCode: internal.statusCode,
    };

    if (path) {
      errorResponse.path = path;
    }

    return response.status(errorResponse.statusCode).json(errorResponse);
  }

  public grpcSuccess(
    data: { message: string; data?: unknown; statusCode?: number },
    correlationId?: string,
  ): GrpcSuccessBody {
    const body: GrpcSuccessBody = {
      success: true,
      message: data.message,
      data: typeof data.data !== 'undefined' ? data.data : [],
      statusCode: data.statusCode ?? HTTP_STATUS_CODES.OK,
      timestamp: new Date().toISOString(),
      errors: [],
    };

    if (correlationId) {
      body.correlationId = correlationId;
    }
    return body;
  }

  public grpcError(
    err: unknown,
    correlationId?: string,
    path?: string,
  ): ErrorBody {
    const timestamp = new Date().toISOString();
    const baseResponse: BaseErrorResponse = {
      success: false,
      timestamp,
    };
    if (correlationId) {
      baseResponse.correlationId = correlationId;
    }
    if (err instanceof BaseHttpException) {
      const errorResponse: ErrorBody = {
        ...baseResponse,
        message: err.message,
        errorType: err.errorType,
        statusCode: err.statusCode,
      };

      if (path) {
        errorResponse.path = path;
      }

      if (
        err.errorType === ErrorType.VALIDATION_ERROR &&
        err.errors &&
        err.errors.length > 0
      ) {
        errorResponse.errors = err.errors;
      }

      return errorResponse;
    }

    const internal = new InternalServerException(COMMON_MESSAGES.ERROR);
    const errorResponse: ErrorBody = {
      ...baseResponse,
      message: internal.message,
      errorType: internal.errorType,
      statusCode: internal.statusCode,
    };

    if (path) {
      errorResponse.path = path;
    }

    return errorResponse;
  }
}

export const responseHelper = new ResponseHelper();
export default responseHelper;
