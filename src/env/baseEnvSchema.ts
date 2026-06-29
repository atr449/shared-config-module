import { z } from 'zod';
import { ENV_MESSAGES } from '../constants/messages';

/**
 * Base environment schema shared by every service.
 *
 * Each service composes this with its own service-specific variables via
 * {@link validateEnv}. Centralising the common DB / Redis / gRPC / RabbitMQ /
 * JWT / S3 variables removes the large, near-identical `environment.ts` files
 * that previously lived in every repo.
 */
export const baseEnvShape = {
  // Core app settings
  NODE_ENV: z.string().default('local'),
  CLUSTER: z.string().default('false'),
  PORT: z.string().default('3000'),

  // Database
  DBNAME: z.string(ENV_MESSAGES.DBNAME_REQUIRED),
  USER_NAME: z.string(ENV_MESSAGES.USER_NAME_REQUIRED),
  PASSWORD: z.string(ENV_MESSAGES.PASSWORD_REQUIRED),
  HOST_NAME: z.string(ENV_MESSAGES.HOST_NAME_REQUIRED),
  READ_HOST_NAME: z.string().optional(),
  DB_PORT: z
    .string(ENV_MESSAGES.DB_PORT_INVALID)
    .regex(/^[0-9]+$/, ENV_MESSAGES.DB_PORT_INVALID),
  DB_SSL: z.string().default('false'),
  DB_SSL_REJECT_UNAUTHORIZED: z.string().default('false'),
  DB_SSL_CA_PATH: z.string().optional().default(''),
  DB_TIMEZONE: z.string().default('+00:00'),

  // Redis
  REDIS_HOST: z.string(ENV_MESSAGES.REDIS_HOST_REQUIRED),
  REDIS_READ_HOST: z.string().optional(),
  REDIS_PORT: z
    .string(ENV_MESSAGES.REDIS_PORT_INVALID)
    .regex(/^[0-9]+$/, ENV_MESSAGES.REDIS_PORT_INVALID),
  REDIS_AUTH: z.string(ENV_MESSAGES.REDIS_AUTH_REQUIRED),
  REDIS_USER: z.string(ENV_MESSAGES.REDIS_USER_REQUIRED),
  REDIS_MODE: z.string().default('single'),

  // RabbitMQ
  RABBITMQ_URL: z.string(ENV_MESSAGES.RABBITMQ_URL_REQUIRED),

  // JWT
  JWTSECRET: z.string(ENV_MESSAGES.JWTSECRET_REQUIRED),

  // Allowed origins: stored as JSON array or comma-separated string
  ALLOWED_ORIGINS: z.string().optional(),

  // S3 (optional)
  S3_ENABLED: z.string().default('false'),
  AWS_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().default('false'),
  S3_PRESIGN_EXPIRES_IN: z
    .string()
    .regex(/^[0-9]+$/, 'S3_PRESIGN_EXPIRES_IN must be a number (seconds)')
    .default('900'),
  S3_KMS_KEY_ID: z.string().optional(),
} as const;

const baseSchema = z.object(baseEnvShape);

export type BaseEnvConfig = z.infer<typeof baseSchema>;

/**
 * Default normalisation applied before validation. Supports common aliases so
 * services that historically used different variable names keep working.
 */
export function defaultNormalize(
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  return {
    ...env,
    // `transactions-service` uses JWT_SECRET; others use JWTSECRET.
    JWTSECRET: env.JWTSECRET ?? env.JWT_SECRET,
    // Common AWS aliases
    AWS_REGION: env.AWS_REGION ?? env.AWS_DEFAULT_REGION,
    S3_BUCKET: env.S3_BUCKET ?? env.AWS_S3_BUCKET,
  };
}

export interface ValidateEnvOptions<T extends z.ZodRawShape> {
  /** Service-specific variables merged on top of the base schema. */
  extend?: T;
  /** Custom normalisation hook (defaults to {@link defaultNormalize}). */
  normalize?: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
  /** Whether to `process.exit(1)` on validation failure (default `true`). */
  exitOnError?: boolean;
}

/**
 * Validate `process.env` against the base schema (optionally extended with
 * service-specific fields) and return a strongly-typed, frozen config object.
 *
 * On failure it logs the flattened Zod errors and exits the process (matching
 * the previous per-service behaviour) unless `exitOnError: false` is passed.
 *
 * @example
 *   export const envAlias = validateEnv({
 *     extend: {
 *       GRPC_HOST: z.string(),
 *       FXG_HOST: z.string().optional().default(''),
 *     },
 *   });
 */
export function validateEnv<T extends z.ZodRawShape = Record<string, never>>(
  options: ValidateEnvOptions<T> = {},
): BaseEnvConfig & z.infer<z.ZodObject<T>> {
  const schema = z.object({
    ...baseEnvShape,
    ...(options.extend ?? ({} as T)),
  });

  const normalize = options.normalize ?? defaultNormalize;
  const parsed = schema.safeParse(normalize(process.env));

  if (!parsed.success) {
    const { fieldErrors, formErrors } = parsed.error.flatten();
    console.error('Invalid environment configuration:', {
      fieldErrors,
      formErrors,
    });
    if (options.exitOnError !== false) {
      process.exit(1);
    }
    throw new Error('Invalid environment configuration');
  }

  return parsed.data as BaseEnvConfig & z.infer<z.ZodObject<T>>;
}
