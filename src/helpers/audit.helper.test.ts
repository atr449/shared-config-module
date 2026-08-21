import { createAuditHelpers } from './audit.helper';
import type { RecordAuditLogMessage } from './audit.helper';
import { AUDIT_LOG_EXCHANGE } from '../constants/audit';

jest.mock('./logger.helper', () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import logger from './logger.helper';

function makePublisher(result: Promise<boolean> = Promise.resolve(true)) {
  return { publishToExchange: jest.fn().mockReturnValue(result) };
}

const BASE_DEPS = {
  routingKey: 'VirtualTopic.AuditLog.Payments',
  projectName: 'baas-payments-services',
};

// Lets the fire-and-forget .catch() handlers inside the audit* trio run.
const flushMicrotasks = () => new Promise(process.nextTick);

describe('createAuditHelpers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('sendAuditLog', () => {
    it('publishes to the audit exchange with topic type and persistent options', async () => {
      const publisher = makePublisher();
      const { sendAuditLog } = createAuditHelpers({ ...BASE_DEPS, publisher });

      const message: RecordAuditLogMessage = {
        projectName: 'baas-payments-services',
        action: 'CREATE_TRANSFER_SUCCESS',
        status: 'SUCCESS',
        occurredAt: '2026-08-18T00:00:00.000Z',
      };

      await expect(sendAuditLog(message)).resolves.toBe(true);
      expect(publisher.publishToExchange).toHaveBeenCalledWith({
        exchangeName: AUDIT_LOG_EXCHANGE,
        exchangeType: 'topic',
        routingKey: 'VirtualTopic.AuditLog.Payments',
        message,
        options: { persistent: true, durable: true },
      });
    });

    it('returns false and warns instead of throwing when the publish fails', async () => {
      const publisher = makePublisher(Promise.reject(new Error('amqp down')));
      const { sendAuditLog } = createAuditHelpers({ ...BASE_DEPS, publisher });

      await expect(
        sendAuditLog({
          projectName: 'p',
          action: 'A',
          status: 'ERROR',
          occurredAt: 'now',
        }),
      ).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith({
        key: 'audit.helper:sendAuditLog:failed',
        error: 'amqp down',
      });
    });

    it('honors exchangeName, logKeyPrefix and prepareMessage overrides', async () => {
      const publisher = makePublisher();
      const prepareMessage = jest.fn((m: RecordAuditLogMessage) => ({
        encoded: m.action,
      }));
      const { sendAuditLog } = createAuditHelpers({
        ...BASE_DEPS,
        publisher,
        exchangeName: 'VirtualTopic.Other',
        logKeyPrefix: 'helpers',
        prepareMessage,
      });

      await sendAuditLog({
        projectName: 'p',
        action: 'A',
        status: 'SUCCESS',
        occurredAt: 'now',
      });
      expect(publisher.publishToExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          exchangeName: 'VirtualTopic.Other',
          message: { encoded: 'A' },
        }),
      );
    });
  });

  describe('audit trio', () => {
    it('auditReceived publishes a SUCCESS intake event without statusCode or responsePayload', async () => {
      const publisher = makePublisher();
      const { auditReceived } = createAuditHelpers({ ...BASE_DEPS, publisher });

      auditReceived('X_RECEIVED', { a: 1 }, 'corr', 'actor', 'vasp', 'now');
      await flushMicrotasks();

      const sent = publisher.publishToExchange.mock.calls[0][0].message;
      expect(sent).toEqual({
        projectName: 'baas-payments-services',
        action: 'X_RECEIVED',
        status: 'SUCCESS',
        requestPayload: JSON.stringify({ a: 1 }),
        correlationId: 'corr',
        actorId: 'actor',
        vaspId: 'vasp',
        occurredAt: 'now',
      });
    });

    it('auditSuccess stamps statusCode 200 and both payloads', async () => {
      const publisher = makePublisher();
      const { auditSuccess } = createAuditHelpers({ ...BASE_DEPS, publisher });

      auditSuccess(
        'X_SUCCESS',
        { a: 1 },
        { b: 2 },
        'corr',
        'actor',
        'vasp',
        'now',
      );
      await flushMicrotasks();

      const sent = publisher.publishToExchange.mock.calls[0][0].message;
      expect(sent).toMatchObject({
        status: 'SUCCESS',
        statusCode: 200,
        requestPayload: JSON.stringify({ a: 1 }),
        responsePayload: JSON.stringify({ b: 2 }),
      });
    });

    it('auditFailure defaults to statusCode 500 and records the error message', async () => {
      const publisher = makePublisher();
      const { auditFailure } = createAuditHelpers({ ...BASE_DEPS, publisher });

      auditFailure(
        'X_FAILED',
        { a: 1 },
        new Error('grpc exploded'),
        'corr',
        'actor',
        'vasp',
        'now',
      );
      await flushMicrotasks();

      const sent = publisher.publishToExchange.mock.calls[0][0].message;
      expect(sent).toMatchObject({
        status: 'ERROR',
        statusCode: 500,
        errorMessage: 'grpc exploded',
      });
    });

    it('auditFailure passes an explicit statusCode through', async () => {
      const publisher = makePublisher();
      const { auditFailure } = createAuditHelpers({ ...BASE_DEPS, publisher });

      auditFailure(
        'X_FAILED',
        {},
        new Error('no'),
        undefined,
        undefined,
        undefined,
        'now',
        401,
      );
      await flushMicrotasks();

      expect(
        publisher.publishToExchange.mock.calls[0][0].message,
      ).toMatchObject({ statusCode: 401 });
    });

    it('merges extra fields (ipAddress, idempotencyKey) into the message', async () => {
      const publisher = makePublisher();
      const { auditReceived } = createAuditHelpers({ ...BASE_DEPS, publisher });

      auditReceived('X_RECEIVED', {}, 'corr', 'actor', 'vasp', 'now', {
        ipAddress: '10.0.0.1',
        idempotencyKey: 'idem-1',
      });
      await flushMicrotasks();

      expect(
        publisher.publishToExchange.mock.calls[0][0].message,
      ).toMatchObject({ ipAddress: '10.0.0.1', idempotencyKey: 'idem-1' });
    });

    it('swallows rejected publishes with a warn instead of an unhandled rejection', async () => {
      const publisher = {
        publishToExchange: jest.fn().mockImplementation(() => {
          throw new Error('sync boom');
        }),
      };
      const { auditReceived } = createAuditHelpers({ ...BASE_DEPS, publisher });

      expect(() =>
        auditReceived('X', {}, undefined, undefined, undefined, 'now'),
      ).not.toThrow();
      await flushMicrotasks();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'audit.helper:sendAuditLog:failed' }),
      );
    });
  });
});
