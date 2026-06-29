import BaseHttpException from './BaseHttpException';
import { HTTP_STATUS_CODES, ErrorType, COMMON_MESSAGES } from '../constants';

export class ValidationException extends BaseHttpException {
  constructor(messages: Array<{ field: string; message: string }>) {
    super(
      HTTP_STATUS_CODES.BAD_REQUEST,
      COMMON_MESSAGES.VALIDATION_FAILED,
      ErrorType.VALIDATION_ERROR,
      messages,
    );
  }
}

export class BadRequestException extends BaseHttpException {
  constructor(message: string) {
    super(HTTP_STATUS_CODES.BAD_REQUEST, message, ErrorType.BUSINESS_ERROR);
  }
}

export class UnauthorizedException extends BaseHttpException {
  constructor(message: string) {
    super(
      HTTP_STATUS_CODES.UNAUTHORIZED,
      message,
      ErrorType.AUTHENTICATION_ERROR,
    );
  }
}

export class ForbiddenException extends BaseHttpException {
  constructor(message: string) {
    super(HTTP_STATUS_CODES.FORBIDDEN, message, ErrorType.AUTHORIZATION_ERROR);
  }
}

export class NotFoundException extends BaseHttpException {
  constructor(message: string) {
    super(HTTP_STATUS_CODES.NOT_FOUND, message, ErrorType.RESOURCE_NOT_FOUND);
  }
}

export class ConflictException extends BaseHttpException {
  constructor(message: string) {
    super(HTTP_STATUS_CODES.CONFLICT, message, ErrorType.BUSINESS_ERROR);
  }
}

export class TooManyRequestsException extends BaseHttpException {
  constructor(message: string) {
    super(
      HTTP_STATUS_CODES.TOO_MANY_REQUESTS,
      message,
      ErrorType.RATE_LIMIT_ERROR,
    );
  }
}

export class InternalServerException extends BaseHttpException {
  constructor(message: string) {
    super(
      HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR,
      message,
      ErrorType.SYSTEM_ERROR,
    );
  }
}

export class ServiceUnavailableException extends BaseHttpException {
  constructor(message: string) {
    super(
      HTTP_STATUS_CODES.SERVICE_UNAVAILABLE,
      message,
      ErrorType.DEPENDENCY_ERROR,
    );
  }
}

export class GatewayTimeoutException extends BaseHttpException {
  constructor(message: string) {
    super(
      HTTP_STATUS_CODES.GATEWAY_TIMEOUT,
      message,
      ErrorType.DEPENDENCY_ERROR,
    );
  }
}
