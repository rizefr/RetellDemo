import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, APIConnectionTimeoutError } from 'retell-sdk';

const mock = vi.hoisted(() => ({
  context: vi.fn(), createAttempt: vi.fn(), updateAttempt: vi.fn(), event: vi.fn(),
  phoneCall: vi.fn(), followup: vi.fn(), updateFollowup: vi.fn(),
}));
vi.mock('../config/env', () => ({ env: {
  OUTBOUND_RETELL_AGENT_ID: 'agent_fixture', OUTBOUND_RETELL_CONVERSATION_FLOW_ID: 'conversation_flow_fixture',
  RETELL_FROM_NUMBER: '+12125550100', OUTBOUND_TEST_PHONE_ALLOWLIST: '+12125550123',
  OUTBOUND_TEST_MODE: true, OUTBOUND_MAX_BATCH_SIZE: 1,
} }));
vi.mock('../services/outboundRepository', () => ({
  getOutboundInvoiceContext: mock.context, nextOutboundAttemptNumber: vi.fn().mockResolvedValue(1),
  createOutboundCallAttempt: mock.createAttempt, updateOutboundCallAttempt: mock.updateAttempt,
  insertOutboundEvent: mock.event, getOutboundFollowupTask: mock.followup,
  updateOutboundFollowupTask: mock.updateFollowup, getOutboundDemoCallAuthorization: vi.fn(),
  touchOutboundDemoCallAuthorization: vi.fn(),
}));
vi.mock('../services/outboundQuickBooksIntegration', () => ({ reverifyQuickBooksInvoiceBeforeOutreach: vi.fn() }));
vi.mock('../services/outboundPhoneSuppression', () => ({ isOutboundPhoneSuppressed: vi.fn().mockResolvedValue(false) }));
vi.mock('../retell/retellClient', () => ({ getRetellClient: () => ({ call: { createPhoneCall: mock.phoneCall } }) }));
import { startOutboundCall } from '../services/outboundCalls';

const now = new Date('2026-09-14T16:00:00Z');
const invoiceId = '00000000-0000-4000-8000-000000000002';
const attemptId = '00000000-0000-4000-8000-000000000004';
let stored: Record<string, unknown> | null;
const context = () => ({
  business: { id: '00000000-0000-4000-8000-000000000001', business_name: 'Demo fixture', is_demo: true, outreach_enabled: true, test_mode: true, test_phone_allowlist: ['+12125550123'], max_batch_size: 1 },
  customer: { id: '00000000-0000-4000-8000-000000000003', first_name: 'Taylor', last_name: 'Morgan', phone_number: '+12125550123', timezone: 'America/New_York', outreach_paused: false },
  invoice: { id: invoiceId, invoice_id: 'TEST-SUBMISSION', source_provider: 'local', amount_due_cents: 15000, currency: 'usd', status: 'unpaid', original_due_date: '2026-08-01', inspection_date: '2026-07-01', service_description: 'Test inspection' },
  activeCall: stored && ['starting', 'registered', 'ongoing'].includes(String(stored.status)) ? stored : null,
  paymentLink: null,
});

beforeEach(() => {
  vi.resetAllMocks(); stored = null;
  mock.context.mockImplementation(async () => context());
  mock.createAttempt.mockImplementation(async input => {
    if (context().activeCall) throw new Error('active invoice reservation conflict');
    stored = { ...input, id: attemptId }; return stored;
  });
  mock.updateAttempt.mockImplementation(async (_id, patch) => { Object.assign(stored!, patch); return stored; });
  mock.phoneCall.mockResolvedValue({ call_id: 'call_fixture', call_status: 'registered' });
  mock.event.mockResolvedValue({});
  mock.followup.mockResolvedValue({ id: 'callback_fixture', invoice_id: invoiceId, task_type: 'callback', status: 'pending', scheduled_for: '2026-09-14T16:00:00Z' });
  mock.updateFollowup.mockResolvedValue({});
});

async function expectHeldAfterFailure(followupId?: string) {
  await expect(startOutboundCall(invoiceId, undefined, now, followupId)).rejects.toThrow('requires reconciliation');
  expect(context().activeCall).toBeTruthy();
  await expect(startOutboundCall(invoiceId, undefined, now, followupId)).rejects.toThrow('active_call_exists');
  expect(mock.phoneCall).toHaveBeenCalledTimes(1);
  expect(mock.phoneCall).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0 });
}

describe('outbound call acceptance and retry boundary', () => {
  it('keeps the reservation when Retell accepts but the first ledger write fails', async () => {
    mock.updateAttempt.mockRejectedValueOnce(new Error('ledger temporarily unavailable'));
    await expectHeldAfterFailure();
    expect(stored).toMatchObject({ status: 'starting', retell_call_id: 'call_fixture' });
    expect(mock.event).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'call_submission_reconciliation_required', payload: expect.objectContaining({ provider_acceptance: 'accepted', retry_allowed: false }) }));
  });

  it('keeps an accepted callback reserved when the callback ledger update fails', async () => {
    mock.updateFollowup.mockRejectedValue(new Error('callback ledger unavailable'));
    await expectHeldAfterFailure('callback_fixture');
    expect(stored).toMatchObject({ status: 'registered', retell_call_id: 'call_fixture' });
  });

  it.each([
    ['timeout', () => new APIConnectionTimeoutError()],
    ['server error', () => new APIError(500, {}, 'server error', new Headers())],
    ['conflict', () => new APIError(409, {}, 'conflict', new Headers())],
    ['untyped status', () => Object.assign(new Error('uncertain result'), { status: 400 })],
  ])('holds an ambiguous %s without another provider request', async (_label, failure) => {
    mock.phoneCall.mockRejectedValue(failure());
    await expectHeldAfterFailure();
    expect(stored).toMatchObject({ status: 'starting' });
    expect(stored?.retell_call_id).toBeUndefined();
  });

  it('does not release the original reservation when reconciliation diagnostics also fail', async () => {
    mock.updateAttempt.mockRejectedValue(new Error('storage unavailable'));
    mock.event.mockRejectedValue(new Error('event storage unavailable'));
    await expectHeldAfterFailure();
    expect(stored).toMatchObject({ status: 'starting' });
  });

  it.each([400, 401, 403, 404, 422, 429])('releases a definite provider rejection (HTTP %s)', async status => {
    const rejection = new APIError(status, {}, 'request rejected', new Headers());
    mock.phoneCall.mockRejectedValueOnce(rejection);
    await expect(startOutboundCall(invoiceId, undefined, now)).rejects.toBe(rejection);
    expect(stored).toMatchObject({ status: 'error' });
    expect(context().activeCall).toBeNull();
    expect(mock.event).not.toHaveBeenCalled();
    expect(await startOutboundCall(invoiceId, undefined, now)).toMatchObject({ call_id: 'call_fixture' });
    expect(mock.phoneCall).toHaveBeenCalledTimes(2);
  });

  it('preserves ordinary successful single-call routing with automatic retries disabled', async () => {
    expect(await startOutboundCall(invoiceId, undefined, now)).toMatchObject({ call_id: 'call_fixture', attempt_id: attemptId });
    expect(mock.phoneCall).toHaveBeenCalledOnce();
    expect(mock.phoneCall).toHaveBeenCalledWith(expect.any(Object), { maxRetries: 0 });
    expect(stored).toMatchObject({ status: 'registered' });
  });
});
