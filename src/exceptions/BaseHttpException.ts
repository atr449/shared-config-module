import { ErrorType } from '../constants';

export class BaseHttpException extends Error {
  public statusCode: number;
  public message!: string;
  public errors?: Array<{ field?: string; message: string }>;
  public errorType: ErrorType;

  constructor(
    statusCode: number,
    message: string,
    errorType: ErrorType,
    errors?: Array<{ field?: string; message: string }>,
  ) {
    super(message);
    // The native Error constructor defines `message` as a non-enumerable own
    // property; `this.message = message` right after super() only updates its
    // VALUE and keeps that non-enumerable attribute (a plain assignment
    // preserves an existing property's descriptor). That silently drops
    // `message` from JSON.stringify/Object.keys/winston's JSON log format --
    // every "{ error }" log line across every service loses the actual error
    // text, keeping only statusCode/errorType. Redefining it explicitly as
    // enumerable is the only way to fix that.
    Object.defineProperty(this, 'message', { value: message, enumerable: true, writable: true, configurable: true });
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.errors = errors && errors.length > 0 ? errors : undefined;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export default BaseHttpException;
