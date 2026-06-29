export interface GenericRequestPusher {
  jwtData?: string;
  userId?: string;
  adminRole?: string;
  userType?: string;
  vaspId?: string;
  fullName?: string;
  permissions?: string[];
}

export interface GetCommonResponse {
  message: string;
  data: object | Array<object>;
}

export interface SuccessBody {
  success: boolean;
  message: string;
  data?: unknown;
  statusCode: number;
  timestamp: string;
  correlationId?: string;
}

export interface ErrorBody {
  success: boolean;
  timestamp: string;
  message: string;
  errorType: string;
  path?: string;
  errors?: Array<{ field?: string; message: string }>;
  statusCode: number;
  correlationId?: string;
}

export interface GrpcSuccessBody {
  success: boolean;
  message: string;
  statusCode: number;
  timestamp: string;
  correlationId?: string;
  data: unknown;
  errors?: Array<{ message: string }>;
}

export interface BaseErrorResponse {
  success: boolean;
  timestamp: string;
  correlationId?: string;
}
