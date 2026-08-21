import type { FastifyReply, FastifyRequest } from 'fastify';
import { withMiddlewareAudit } from './middleware-audit.helper';
import type { TaggedError } from './middleware-audit.helper';

function makeReq(): FastifyRequest {
  return {} as unknown as FastifyRequest;
}

describe('withMiddlewareAudit', () => {
  it('resolves without tagging anything when the wrapped handler succeeds', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const wrapped = withMiddlewareAudit('SOME_ACTION', handler);

    await expect(wrapped(makeReq())).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tags a thrown Error with auditAction and rethrows the same error', async () => {
    const original = new Error('boom');
    const handler = jest.fn().mockRejectedValue(original);
    const wrapped = withMiddlewareAudit('FAPI_AUTH_FAILED', handler);

    await expect(wrapped(makeReq())).rejects.toBe(original);
    expect((original as TaggedError).auditAction).toBe('FAPI_AUTH_FAILED');
  });

  it('does not overwrite an auditAction already set by an inner wrapper', async () => {
    const original = new Error('boom') as TaggedError;
    original.auditAction = 'INNER_ACTION';
    const handler = jest.fn().mockRejectedValue(original);
    const wrapped = withMiddlewareAudit('OUTER_ACTION', handler);

    await expect(wrapped(makeReq())).rejects.toBe(original);
    expect(original.auditAction).toBe('INNER_ACTION');
  });

  it('rethrows non-Error rejections untagged', async () => {
    const handler = jest.fn().mockRejectedValue('not an Error instance');
    const wrapped = withMiddlewareAudit('SOME_ACTION', handler);

    await expect(wrapped(makeReq())).rejects.toBe('not an Error instance');
  });

  it('preserves the arity of multi-argument handlers and forwards every argument', async () => {
    const handler = jest.fn(
      async (_request: FastifyRequest, _reply: FastifyReply): Promise<void> =>
        undefined,
    );
    const wrapped = withMiddlewareAudit<[FastifyRequest, FastifyReply]>(
      'IDEMPOTENCY_KEY_FAILED',
      handler,
    );
    const request = makeReq();
    const reply = {} as unknown as FastifyReply;

    await expect(wrapped(request, reply)).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledWith(request, reply);
  });
});
