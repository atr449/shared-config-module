import type {
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
import { requireOptionalPeer } from './optionalPeer.helper';

type SequelizeErrorClasses = {
  ValidationError: new (...args: unknown[]) => ValidationError;
  UniqueConstraintError: new (...args: unknown[]) => UniqueConstraintError;
  ForeignKeyConstraintError: new (
    ...args: unknown[]
  ) => ForeignKeyConstraintError;
  DatabaseError: new (...args: unknown[]) => DatabaseError;
  TimeoutError: new (...args: unknown[]) => TimeoutError;
  ConnectionError: new (...args: unknown[]) => ConnectionError;
};

// `sequelize` is an optional peer — services without a database never
// install it. Loaded lazily (and cached) on first use so importing this
// module never requires `sequelize` to be present; when it isn't, DB-error
// mapping is simply skipped and callers fall through to generic handling.
let sequelizeErrors: SequelizeErrorClasses | null | undefined;

function loadSequelizeErrors(): SequelizeErrorClasses | null {
  if (sequelizeErrors !== undefined) return sequelizeErrors;
  let loaded: SequelizeErrorClasses | null;
  try {
    loaded = requireOptionalPeer<SequelizeErrorClasses>(
      'sequelize',
      'checkDbError',
    );
  } catch {
    loaded = null;
  }
  sequelizeErrors = loaded;
  return loaded;
}

/**
 * Map a Sequelize error to the appropriate shared HTTP exception.
 * Returns `null` when the error is not a recognised Sequelize error, or when
 * the optional `sequelize` peer isn't installed, so the caller can fall
 * through to generic handling.
 */
export function checkDbError(err: unknown): BaseDbMapped {
  const seq = loadSequelizeErrors();
  if (!seq) return null;

  if (err instanceof seq.UniqueConstraintError) {
    const msg = err.errors?.[0]?.message || DATABASE_MESSAGES.DUPLICATE_ENTRY;
    return new ConflictException(msg);
  }

  if (err instanceof seq.ForeignKeyConstraintError) {
    return new BadRequestException(
      DATABASE_MESSAGES.FOREIGN_KEY_CONSTRAINT_FAILED,
    );
  }

  if (err instanceof seq.ValidationError) {
    const message =
      err.errors?.[0]?.message || DATABASE_MESSAGES.VALIDATION_FAILED;
    return new BadRequestException(message);
  }

  if (err instanceof seq.TimeoutError) {
    return new GatewayTimeoutException(DATABASE_MESSAGES.QUERY_TIMEOUT);
  }

  if (err instanceof seq.ConnectionError) {
    return new ServiceUnavailableException(DATABASE_MESSAGES.CONNECTION_FAILED);
  }

  if (err instanceof seq.DatabaseError) {
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
