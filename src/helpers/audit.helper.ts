import logger from './logger.helper';
import { AUDIT_LOG_EXCHANGE, AUDIT_STATUS } from '../constants/audit';
import type { AuditStatus } from '../constants/audit';
import { EXCHANGE_TYPE } from '../constants/messaging';
import { HTTP_STATUS_CODES } from '../constants/http';
import type { PublishToExchangeConfig } from '../interfaces/rabbitmq.interface';

/**
 * The message contract of baas-audit-log-service's recordAuditLogRequestSchema.
 * `ipAddress`, `eventId` and `idempotencyKey` are optional extensions only some
 * services record - the consumer's schema accepts them all.
 */
export interface RecordAuditLogMessage {
  projectName: string;
  action: string;
  status: AuditStatus;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  requestPayload?: string; // JSON string - baas-audit-log-service parses + redacts
  responsePayload?: string; // JSON string
  correlationId?: string;
  actorId?: string;
  vaspId?: string;
  /** Caller IP, from the x-fapi-customer-ip-address header. */
  ipAddress?: string;
  eventId?: string;
  idempotencyKey?: string;
  occurredAt: string; // ISO 8601
}

/**
 * Per-event fields beyond the common positional arguments, merged into the
 * published message (e.g. `{ ipAddress }` or `{ idempotencyKey }`).
 */
export type AuditExtra = Partial<
  Pick<
    RecordAuditLogMessage,
    'ipAddress' | 'eventId' | 'idempotencyKey' | 'errorCode'
  >
>;

/**
 * Minimal structural shape of the RabbitMQ publisher this needs (satisfied by
 * `createRabbitMQClient(...).publisher`). Declared structurally rather than
 * importing the concrete client so a service can pass its own instance (or a
 * stub, in tests) without this module dictating how RabbitMQ is constructed.
 * The config parameter is the canonical `PublishToExchangeConfig` so the
 * concrete publisher's function-property signature stays assignable under
 * strictFunctionTypes.
 */
export interface AuditLogPublisher {
  publishToExchange(config: PublishToExchangeConfig): Promise<boolean>;
}

export interface AuditHelperDeps {
  publisher: AuditLogPublisher;
  /** Per-service routing key, e.g. 'VirtualTopic.AuditLog.Payments'. */
  routingKey: string;
  /** `projectName` stamped on every message, e.g. 'baas-payments-services'. */
  projectName: string;
  /** Exchange to publish to; the platform-wide audit exchange by default. */
  exchangeName?: string;
  /** Prefix of the `key` field in failure logs (default 'audit.helper'). */
  logKeyPrefix?: string;
  /**
   * Transforms the message just before publishing - for services whose
   * consumer contract is not plain JSON (e.g. Avro-encoded, with a generated
   * eventId). Defaults to identity.
   */
  prepareMessage?: (message: RecordAuditLogMessage) => unknown;
}

export interface AuditHelpers {
  sendAuditLog(message: RecordAuditLogMessage): Promise<boolean>;
  auditReceived(
    action: string,
    requestPayload: unknown,
    correlationId: string | undefined,
    actorId: string | undefined,
    vaspId: string | undefined,
    occurredAt: string,
    extra?: AuditExtra,
  ): void;
  auditSuccess(
    action: string,
    requestPayload: unknown,
    responsePayload: unknown,
    correlationId: string | undefined,
    actorId: string | undefined,
    vaspId: string | undefined,
    occurredAt: string,
    extra?: AuditExtra,
  ): void;
  auditFailure(
    action: string,
    requestPayload: unknown,
    error: unknown,
    correlationId: string | undefined,
    actorId: string | undefined,
    vaspId: string | undefined,
    occurredAt: string,
    statusCode?: number,
    extra?: AuditExtra,
  ): void;
}

/**
 * Builds the audit-log publishing helpers for a service.
 *
 * Previously copied into 6 services with identical logic (only the routing
 * key, project name and log-key prefix differed). The publisher is injected
 * rather than imported because it is a per-service instance (each service has
 * its own RabbitMQ URL and connection); only the *logic* is shared.
 *
 * The `audit*` trio is fire-and-forget - it never blocks or masks the
 * caller's response. Publish failures are logged at warn and swallowed.
 *
 * @example
 *   export const { sendAuditLog, auditReceived, auditSuccess, auditFailure } =
 *     createAuditHelpers({
 *       publisher,
 *       routingKey: AUDIT_QUEUE_PROVIDER.ROUTING_KEY.AUDIT_PAYMENTS,
 *       projectName: AUDIT_LOG_PROJECT_NAME,
 *     });
 */
export function createAuditHelpers(deps: AuditHelperDeps): AuditHelpers {
  const {
    publisher,
    routingKey,
    projectName,
    exchangeName = AUDIT_LOG_EXCHANGE,
    logKeyPrefix = 'audit.helper',
    prepareMessage = (message: RecordAuditLogMessage): unknown => message,
  } = deps;

  async function sendAuditLog(
    message: RecordAuditLogMessage,
  ): Promise<boolean> {
    try {
      return await publisher.publishToExchange({
        exchangeName,
        exchangeType: EXCHANGE_TYPE.TOPIC,
        routingKey,
        message: prepareMessage(message),
        options: { persistent: true, durable: true },
      });
    } catch (error) {
      logger.warn({
        key: `${logKeyPrefix}:sendAuditLog:failed`,
        error: (error as Error)?.message,
      });
      return false;
    }
  }

  /**
   * "Request received" marker, published before the downstream call is made.
   * Uses status:'SUCCESS' (the consumer's schema only accepts
   * 'SUCCESS'|'ERROR') - the distinct '_RECEIVED' action name, not the
   * status, is what marks this as the intake event rather than the final
   * outcome. No responsePayload yet, since there's no response.
   */
  function auditReceived(
    action: string,
    requestPayload: unknown,
    correlationId: string | undefined,
    actorId: string | undefined,
    vaspId: string | undefined,
    occurredAt: string,
    extra?: AuditExtra,
  ): void {
    sendAuditLog({
      projectName,
      action,
      status: AUDIT_STATUS.SUCCESS,
      requestPayload: JSON.stringify(requestPayload),
      correlationId,
      actorId,
      vaspId,
      occurredAt,
      ...extra,
    }).catch((err: unknown) =>
      logger.warn({
        key: `${logKeyPrefix}:auditReceived:failed`,
        action,
        error: (err as Error)?.message,
      }),
    );
  }

  function auditSuccess(
    action: string,
    requestPayload: unknown,
    responsePayload: unknown,
    correlationId: string | undefined,
    actorId: string | undefined,
    vaspId: string | undefined,
    occurredAt: string,
    extra?: AuditExtra,
  ): void {
    sendAuditLog({
      projectName,
      action,
      status: AUDIT_STATUS.SUCCESS,
      statusCode: HTTP_STATUS_CODES.OK,
      requestPayload: JSON.stringify(requestPayload),
      responsePayload: JSON.stringify(responsePayload),
      correlationId,
      actorId,
      vaspId,
      occurredAt,
      ...extra,
    }).catch((err: unknown) =>
      logger.warn({
        key: `${logKeyPrefix}:auditSuccess:failed`,
        action,
        error: (err as Error)?.message,
      }),
    );
  }

  function auditFailure(
    action: string,
    requestPayload: unknown,
    error: unknown,
    correlationId: string | undefined,
    actorId: string | undefined,
    vaspId: string | undefined,
    occurredAt: string,
    // Most call sites are a post-downstream-call catch block, where the
    // downstream call genuinely errored - 500 is the right default there.
    // A global error handler auditing preHandler-stage failures passes the
    // error's real statusCode (e.g. 401/400) instead, since those failures
    // are client errors, not server errors.
    statusCode: number = HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR,
    extra?: AuditExtra,
  ): void {
    sendAuditLog({
      projectName,
      action,
      status: AUDIT_STATUS.ERROR,
      statusCode,
      errorMessage: (error as Error)?.message,
      requestPayload: JSON.stringify(requestPayload),
      correlationId,
      actorId,
      vaspId,
      occurredAt,
      ...extra,
    }).catch((err: unknown) =>
      logger.warn({
        key: `${logKeyPrefix}:auditFailure:failed`,
        action,
        error: (err as Error)?.message,
      }),
    );
  }

  return { sendAuditLog, auditReceived, auditSuccess, auditFailure };
}
