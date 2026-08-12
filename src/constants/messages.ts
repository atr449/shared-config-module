/* ======================================================
   Shared, non-domain message catalogues.
   Domain message groups (transaction, end-customer, user,
   virtual-account, etc.) intentionally remain in each service.
====================================================== */

/* ------------------------------------------------------
   COMMON / GENERIC MESSAGES
------------------------------------------------------ */
export const COMMON_MESSAGES = {
  SUCCESS: 'Success',
  ERROR: 'Something went wrong',
  NO_RECORDS_FOUND: 'No records found',
  INVALID_URL: 'Invalid URL',
  ROUTE_NOT_FOUND: 'Route not found',
  RATE_LIMIT_EXCEEDED: 'Too many requests',
  CORS_NOT_ALLOWED: 'Request not allowed',
  VASP_ID_REQUIRED: 'vaspId is required',
  VALIDATION_FAILED: 'Request validation failed',
} as const;

/* ------------------------------------------------------
   MIDDLEWARE MESSAGES
------------------------------------------------------ */
export const MIDDLEWARE_MESSAGES = {
  SESSION_EXPIRED: 'Session has been expired',
  PERMISSION_DENIED: 'Permission has been denied for this user',
  JWT_REQUIRED: 'JWT token must be provided',
  INVALID_TOKEN: 'Invalid token',
  AUTHENTICATION_FAILED: 'Authentication failed',
} as const;

/* ------------------------------------------------------
   VALIDATION MESSAGES (GENERIC)
------------------------------------------------------ */
export const VALIDATION_MESSAGES = {
  PAGE_REQUIRED: 'Page is required',
  LIMIT_REQUIRED: 'Limit is required',
  PAGE_AND_LIMIT_REQUIRED: 'Page and limit are required',
  PAGE_MIN_1: 'Page must be greater than 0',
  PAGE_INVALID: 'Page must be a valid number greater than 0',
  LIMIT_INVALID: 'Limit must be a valid number between 1 and 100',
  LIMIT_MAX_EXCEEDED: 'Limit cannot exceed 100',
} as const;

/* ------------------------------------------------------
   ENVIRONMENT VALIDATION MESSAGES
------------------------------------------------------ */
export const ENV_MESSAGES = {
  DBNAME_REQUIRED: 'DBNAME is required',
  USER_NAME_REQUIRED: 'USER_NAME is required',
  PASSWORD_REQUIRED: 'PASSWORD is required',
  HOST_NAME_REQUIRED: 'HOST_NAME is required',
  DB_PORT_INVALID: 'DB_PORT must be a number',
  REDIS_HOST_REQUIRED: 'REDIS_HOST is required',
  REDIS_PORT_INVALID: 'REDIS_PORT must be a number',
  REDIS_AUTH_REQUIRED: 'REDIS_AUTH is required',
  REDIS_USER_REQUIRED: 'REDIS_USER is required',
  JWTSECRET_REQUIRED: 'JWTSECRET is required',
  JWTADMINSECRET_REQUIRED: 'JWTADMINSECRET is required',
  GRPC_ENABLE_DISABLE_INVALID: 'GRPC_ENABLE_DISABLE must be 0 or 1',
  GRPC_HOST_REQUIRED: 'GRPC_HOST is required',
  USER_HOST_REQUIRED: 'USER_HOST is required',
  BANKING_HOST_REQUIRED: 'BANKING_HOST is required',
  MAX_GRPC_MESSAGE_SIZE_INVALID: 'MAX_GRPC_MESSAGE_SIZE must be a number',
  BUCKET_NAME_REQUIRED: 'BUCKET_NAME is required',
  AWS_ACCESS_KEY_REQUIRED: 'AWS_ACCESS_KEY is required',
  AWS_SECRET_KEY_REQUIRED: 'AWS_SECRET_KEY is required',
  AWS_REGION_REQUIRED: 'AWS_REGION is required',
  RABBITMQ_URL_REQUIRED: 'RABBITMQ_URL is required',
  FXG_HOST_REQUIRED: 'FXG_HOST is required',
} as const;

/* ------------------------------------------------------
   FILE UPLOAD MESSAGES
------------------------------------------------------ */
export const FILE_UPLOAD_MESSAGES = {
  FILE_REQUIRED: 'file is required',
  INVALID_FILE_TYPE: (allowed: string[]): string =>
    `Invalid file type. Allowed: ${allowed.join(', ')}`,
  FILE_TOO_LARGE: (maxMb: number): string => `File too large (max ${maxMb}MB).`,
} as const;

/* ------------------------------------------------------
   S3 MESSAGES
------------------------------------------------------ */
export const S3_MESSAGES = {
  NOT_ENABLED: 'S3 is not enabled',
  BUCKET_REQUIRED: 'S3_BUCKET is required',
  REGION_REQUIRED: 'AWS_REGION is required',
} as const;

/* ------------------------------------------------------
   DATABASE ERROR MESSAGES
------------------------------------------------------ */
export const DATABASE_MESSAGES = {
  DUPLICATE_ENTRY: 'Duplicate entry',
  FOREIGN_KEY_CONSTRAINT_FAILED: 'Foreign key constraint failed',
  VALIDATION_FAILED: 'Validation failed',
  QUERY_TIMEOUT: 'Query timeout',
  CONNECTION_FAILED: 'Database connection failed',
  DATABASE_ERROR: 'Database error',
} as const;

/* ------------------------------------------------------
   gRPC MESSAGES (ERROR & VALIDATION ONLY)
------------------------------------------------------ */
export const GRPC_MESSAGES = {
  ERROR: {
    MISSING_CORRELATION_ID: 'Missing correlation id',
    SERVICE_NOT_FOUND: 'gRPC service not found',
    CLIENT_NOT_INITIALIZED: 'gRPC client is not initialized',
    INTERNAL_ERROR: 'Internal gRPC error',
    OPERATION_FAILED: 'Error in performing gRPC operation',
  },
  VALIDATION: {
    INVALID_REQUEST: 'Invalid gRPC request',
    REQUIRED_FIELD_MISSING: 'Required field is missing',
  },
} as const;

/* ------------------------------------------------------
   ERROR CODES (MACHINE READABLE)
------------------------------------------------------ */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
} as const;

/* ------------------------------------------------------
   IDEMPOTENCY MESSAGES
------------------------------------------------------ */
export const IDEMPOTENCY_MESSAGES = {
  KEY_REQUIRED: 'x-idempotency-key header is required',
  KEY_INVALID_FORMAT:
    'x-idempotency-key must be a valid UUID v4 (e.g. 8f4d4b32-a51f-4c57-9d51-91c2b1fa83ab)',
  KEY_REUSED:
    'Same idempotency key cannot be reused with a different request payload',
  REQUEST_ALREADY_PROCESSING:
    'Request is currently being processed. Please retry after a moment.',
  LOCK_SERVICE_UNAVAILABLE:
    'Transaction lock service is temporarily unavailable. Please retry.',
} as const;

/* ------------------------------------------------------
   FAPI HEADER MESSAGES
   Duplicated verbatim across every BaaS service's FAPI auth
   middleware (accounts, payments, beneficiaries, transactions, ...).
------------------------------------------------------ */
export const FAPI_MESSAGES = {
  MISSING_INTERACTION_ID: 'x-fapi-interaction-id header is required',
  MISSING_VASP_ID: 'x-fapi-vasp-id header is required',
  MISSING_CUSTOMER_IP: 'x-fapi-customer-ip-address header is required',
  MISSING_CORRELATION_ID: 'x-fxg-correlation-id header is required',
  INVALID_CORRELATION_ID_FORMAT:
    'x-fxg-correlation-id must be a valid UUID (e.g. 00000000-0000-4000-8000-000000000001)',
  MISSING_AUTH_TOKEN: 'Authorization Bearer token is required',
  INVALID_AUTH_TOKEN: 'Invalid or expired token',
  INVALID_CLIENT_ID: 'client_id is not registered for any VASP',
  VASP_ID_MISMATCH:
    'x-fapi-vasp-id does not match the VASP registered for this client_id',
  CLIENT_VALIDATION_UNAVAILABLE: 'Unable to validate client_id at this time',
} as const;
