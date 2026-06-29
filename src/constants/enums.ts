/**
 * Cross-cutting enums shared by every service. Domain-specific enums
 * (customer/account/transaction statuses, notification types, etc.) stay
 * inside each service.
 */

/** Machine-readable error categories attached to every error response. */
export enum ErrorType {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  DEPENDENCY_ERROR = 'DEPENDENCY_ERROR',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
}

/** Status of an idempotency record used by the idempotency middleware/helpers. */
export enum IDEMPOTENCY_RECORD_STATUS {
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

/** User type carried in the JWT, used for authorization / filtering. */
export enum UserType {
  VASP = 'VASP',
  FXG = 'FXG',
}
