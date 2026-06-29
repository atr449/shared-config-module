import { ErrorType } from '../constants';

export class BaseHttpException extends Error {
  public statusCode: number;
  public message: string;
  public errors?: Array<{ field?: string; message: string }>;
  public errorType: ErrorType;

  constructor(
    statusCode: number,
    message: string,
    errorType: ErrorType,
    errors?: Array<{ field?: string; message: string }>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.message = message;
    this.errorType = errorType;
    this.errors = errors && errors.length > 0 ? errors : undefined;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export default BaseHttpException;
