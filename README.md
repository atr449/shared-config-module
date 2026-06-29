# @fusionxglobal/shared-config

Shared configuration, constants, exceptions, structured logging, OpenTelemetry
tracing and Express middleware for the FusionX VASP microservices.

This package extracts the code that was previously copy-pasted (and slowly
drifting) across `accounts-service`, `customers-service`, `payments-service`,
and the rest of the fleet.

## What's inside

| Area | Exports |
| --- | --- |
| **Runtime** | `initSharedConfig`, `getSharedConfig`, `SharedRuntimeConfig` |
| **Constants** | `HTTP_STATUS_CODES`, `HTTP_METHODS`, `HEADERS`, `LOG_LEVEL`, `ENVIRONMENT`, `REDIS_MODE`, `PAGINATION`, `LOGGING_CONFIG`, `CLUSTER_CONFIG`, `RATE_LIMIT` |
| **Enums** | `ErrorType`, `IDEMPOTENCY_RECORD_STATUS`, `UserType` |
| **Messages** | `COMMON_MESSAGES`, `MIDDLEWARE_MESSAGES`, `VALIDATION_MESSAGES`, `ENV_MESSAGES`, `DATABASE_MESSAGES`, `GRPC_MESSAGES`, `ERROR_CODES`, `IDEMPOTENCY_MESSAGES`, ... |
| **Exceptions** | `BaseHttpException` + `BadRequestException`, `NotFoundException`, `ConflictException`, ... and `NonRetryableError` |
| **Helpers** | `logger`, `getLogger`, `responseHelper`/`ResponseHelper`, `checkDbError`, `startTracing`, `stopTracing`, `asyncLocalStorage` |
| **Middlewares** | `correlationIdMiddleware`, `errorMiddleware`, `requestLoggerMiddleware` |
| **Clients** | `createRedisClient`, `createDatabase`, `createRabbitMQClient`, `createS3Client`, `createSesClient` |
| **Logging (AOP)** | `LogMethod`, `LogClass`, `wrapWithLogging`, `redactSensitiveData`, `maskValue` |
| **Env** | `loadEnvSync`, `getEnvPath`, `validateEnv`, `baseEnvShape` |

## Install

The package is published to **GitHub Packages** under the `@fusionxglobal`
scope. Each consuming repo needs an `.npmrc`:

```
@fusionxglobal:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @fusionxglobal/shared-config
```

> During local development before the first publish you can consume it directly:
> `npm install file:../shared-config-module`

## Usage

### 1. Bootstrap (top of `server.ts`)

```ts
import { loadEnvSync, initSharedConfig, startTracing } from '@fusionxglobal/shared-config';

// 1. Load the right <env>.env (point at the dir that holds your env files)
loadEnvSync(__dirname + '/config');

// 2. Initialise shared infra ONCE — logger + tracing read this.
initSharedConfig({ serviceName: 'accounts-service', nodeEnv: process.env.NODE_ENV });

// 3. Start OpenTelemetry (no-op if OTEL_EXPORTER_OTLP_ENDPOINT is unset)
startTracing();
```

### 2. Environment validation

```ts
import { validateEnv } from '@fusionxglobal/shared-config';
import { z } from 'zod';

export const envAlias = validateEnv({
  extend: {
    GRPC_HOST: z.string(),
    GRPC_ENABLE_DISABLE: z.string().regex(/^[01]$/).transform(Number),
    FXG_HOST: z.string().optional().default(''),
  },
});
```

### 3. Express wiring

```ts
import {
  correlationIdMiddleware,
  requestLoggerMiddleware,
  errorMiddleware,
} from '@fusionxglobal/shared-config';

app.use(correlationIdMiddleware);
app.use(requestLoggerMiddleware);
// ...routes...
app.use(errorMiddleware);
```

### 4. Logger / exceptions / response helper

```ts
import { logger, NotFoundException, responseHelper } from '@fusionxglobal/shared-config';

logger.info('hello');                       // correlation-id + trace-id aware
throw new NotFoundException('User not found');
responseHelper.success(res, { message: 'ok', data });
```

### 5. Client initialization (Redis / DB / RabbitMQ)

The connection, pooling, retry, TLS and OTel-propagation logic is shared; each
service supplies only its own config. Create the clients once and re-export the
instances:

```ts
// helpers/redis.helper.ts
import { createRedisClient } from '@fusionxglobal/shared-config';
import { REDIS } from '../constants';
export default createRedisClient({
  host: REDIS.HOST, readHost: REDIS.READ_HOST, port: REDIS.PORT,
  auth: REDIS.AUTH, user: REDIS.USER, mode: REDIS.MODE,
});

// helpers/sequelize.helper.ts — models import `sequelize` from here
import { createDatabase } from '@fusionxglobal/shared-config';
import { DATABASE, NODE_ENV } from '../constants';
const db = createDatabase({
  dbName: DATABASE.DBNAME, username: DATABASE.USER_NAME, password: DATABASE.PASSWORD,
  host: DATABASE.HOST_NAME, readHost: DATABASE.READ_HOST_NAME, port: DATABASE.PORT,
  ssl: DATABASE.SSL, sslRejectUnauthorized: DATABASE.SSL_REJECT_UNAUTHORIZED,
  sslCaPath: DATABASE.SSL_CA_PATH, timezone: DATABASE.TIMEZONE, nodeEnv: NODE_ENV,
});
export const { sequelize, initializeDatabase, closeDatabase } = db;

// helpers/rabbitmq.helper.ts
import { createRabbitMQClient } from '@fusionxglobal/shared-config';
import { RABBITMQ_URL, EXCHANGE_CONFIGURATION, ASSERTION_CONFIG, NODE_ENV } from '../constants';
const { publisher, consumer, helper } = createRabbitMQClient({
  url: RABBITMQ_URL, exchanges: EXCHANGE_CONFIGURATION, queues: ASSERTION_CONFIG, nodeEnv: NODE_ENV,
});
export { publisher, consumer };
```

```ts
// helpers/s3.helper.ts
import { createS3Client } from '@fusionxglobal/shared-config';
import { S3_CONFIG } from '../constants';
export default createS3Client({
  region: S3_CONFIG.REGION, bucket: S3_CONFIG.BUCKET, endpoint: S3_CONFIG.ENDPOINT,
  forcePathStyle: S3_CONFIG.FORCE_PATH_STYLE, presignExpiresIn: S3_CONFIG.PRESIGN_EXPIRES_IN,
  kmsKeyId: S3_CONFIG.KMS_KEY_ID,
});

// helpers/ses.helper.ts
import { createSesClient } from '@fusionxglobal/shared-config';
import { AWS_SES } from '../constants';
const ses = createSesClient({ region: AWS_SES.REGION, fromEmail: AWS_SES.FROM_EMAIL });
export const sendMail = ses.sendMail.bind(ses);
```

`ioredis`, `rabbitmq-with-retry-and-dlq`, `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner` and `@aws-sdk/client-ses` are **optional** peer
dependencies — only required if you use the matching client.

### 6. AOP method logging (no per-method log lines)

Stop writing `logger.info('enter X')` / `logger.info('exit X')` by hand. Entry,
exit (with duration), errors, argument redaction and the ambient
correlation-id / trace-id are applied automatically.

```ts
import { LogClass, LogMethod, wrapWithLogging } from '@fusionxglobal/shared-config';

// Whole class (prototype methods):
@LogClass()
class PaymentService {
  async charge(dto: ChargeDto) { /* ... */ }   // → ← ✖ logged automatically
}

// Single method:
class FooService { @LogMethod({ logResult: true }) async bar() { /* ... */ } }

// Classes that use arrow-function properties (can't be decorated) — wrap the
// instance; a Proxy logs every method call:
export default wrapWithLogging(new AccountsService(), { label: 'AccountsService' });
```

Output (via the shared Winston logger, so it carries service/correlationId/traceId):

```
→ PaymentService.charge        { args: [ { amount: 100, card: '[REDACTED]' } ] }
← PaymentService.charge (12ms) { durationMs: 12 }
✖ PaymentService.charge (4ms)  { error: { name, message, stack } }
```

Entry/exit log at `debug` by default (suppressed in deployed envs where the
level is `info`), so production stays quiet unless you opt in. Errors log at
`error`. Tune with `{ level, logArgs, logResult, logErrors, redact, label }`.

## Versioning & install from a git tag

Tagging is **pipeline-driven**: bump `version` in `package.json` in your PR;
when it merges to `main`, `.github/workflows/release.yml` creates the matching
`vX.Y.Z` tag and a GitHub Release automatically (`ci.yml` builds/type-checks on
every PR). Don't create tags by hand.

Services depend on a tag directly:

```jsonc
// package.json
"@fusionxglobal/shared-config": "github:fusionxglobal/shared-config-module#v1.0.0"
// or: "git+https://github.com/fusionxglobal/shared-config-module.git#v1.0.0"
```

`dist/` is git-ignored; the `prepare` script builds it automatically when npm
installs from git.

## Design notes

- **Object initialisation:** shared infrastructure does not hard-code a service
  name. `initSharedConfig()` populates a singleton that the lazily-built logger
  and tracer read. The exported `logger` is a proxy, so it picks up the resolved
  config no matter the import order.
- **Peer dependencies:** `express`, `sequelize`, `winston`, `zod` and
  `@opentelemetry/api` are peers so there is exactly **one** instance shared with
  the host service (required for `instanceof` checks and a single trace context).

## Build

```bash
npm install
npm run build      # → dist/ (JS + .d.ts)
npm run typecheck
```
