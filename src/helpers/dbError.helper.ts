import {
  ValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError,
  TimeoutError,
  ConnectionError,
} from 'sequelize';
import {
  BadRequestException,
  ConflictException,
  InternalServerException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '../exceptions';
import { DATABASE_MESSAGES } from '../constants';

/**
 * Map a Sequelize error to the appropriate shared HTTP exception.
 * Returns `null` when the error is not a recognised Sequelize error so the
 * caller can fall through to generic handling.
 */
export function checkDbError(err: unknown): BaseDbMapped {
  if (err instanceof UniqueConstraintError) {
    const msg = err.errors?.[0]?.message || DATABASE_MESSAGES.DUPLICATE_ENTRY;
    return new ConflictException(msg);
  }

  if (err instanceof ForeignKeyConstraintError) {
    return new BadRequestException(
      DATABASE_MESSAGES.FOREIGN_KEY_CONSTRAINT_FAILED,
    );
  }

  if (err instanceof ValidationError) {
    const message =
      err.errors?.[0]?.message || DATABASE_MESSAGES.VALIDATION_FAILED;
    return new BadRequestException(message);
  }

  if (err instanceof TimeoutError) {
    return new GatewayTimeoutException(DATABASE_MESSAGES.QUERY_TIMEOUT);
  }

  if (err instanceof ConnectionError) {
    return new ServiceUnavailableException(DATABASE_MESSAGES.CONNECTION_FAILED);
  }

  if (err instanceof DatabaseError) {
    return new InternalServerException(DATABASE_MESSAGES.DATABASE_ERROR);
  }

  return null;
}

type BaseDbMapped =
  | BadRequestException
  | ConflictException
  | InternalServerException
  | GatewayTimeoutException
  | ServiceUnavailableException
  | null;
