import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(), business: vi.fn(), authorization: vi.fn(), createAuthorization: vi.fn(),
  createAttempt: vi.fn(), event: vi.fn(), updateAttempt: vi.fn(), updateBusiness: vi.fn(),
  reverify: vi.fn(), phoneCall: vi.fn(),
}));
vi.mock('../services/outboundRepository', async () => ({
  ...await vi.importActual<typeof import('../services/outboundRepository')>('../services/outboundRepository'),
  getOutboundInvoiceContext: mocks.context,
  getOutboundBusinessSettings: mocks.business,
  getOutboundDemoCallAuthorization: mocks.authorization,
  createOutboundDemoCallAuthorization: mocks.createAuthorization,
  createOutboundCallAttempt: mocks.createAttempt,
  insertOutboundEvent: mocks.event,
  updateOutboundCallAttempt: mocks.updateAttempt,
  updateOutboundBusinessSettings: mocks.updateBusiness,
  nextOutboundAttemptNumber: vi.fn().mockResolvedValue(1),
}));
vi.mock('../services/outboundQuickBooksIntegration', async () => ({
  ...await vi.importActual<typeof import('../services/outboundQuickBooksIntegration')>('../services/outboundQuickBooksIntegration'),
  reverifyQuickBooksInvoiceBeforeOutreach: mocks.reverify,
}));
vi.mock('../services/outboundPhoneSuppression', () => ({ isOutboundPhoneSuppressed: vi.fn().mockResolvedValue(false) }));
vi.mock('../retell/retellClient', () => ({ getRetellClient: () => ({ call: { createPhoneCall: mocks.phoneCall } }) }));

const businessId = '00000000-0000-4000-8000-000000000011';
const invoiceId = '00000000-0000-4000-8000-000000000012';
const authorizationId = '00000000-0000-4000-8000-000000000013';
const phone = '+12125550123';
const now = new Date('2026-09-14T16:00:00.000Z');
function context(enabled: boolean | null | undefined = false, source = 'quickbooks') {
  return {
    business: {
      id: businessId, business_name: 'Accounting review fixture', is_demo: false,
      ...(enabled === undefined ? {} : { outreach_enabled: enabled }),
      test_mode: true, test_phone_allowlist: [phone], max_batch_size: 1,
      allow_after_hours_test_override: true, default_timezone: 'America/New_York',
      payment_email_enabled: false, retell_sms_enabled: false,
    },
    customer: { id: '00000000-0000-4000-8000-000000000014', first_name: 'Taylor', last_name: 'Morgan', phone_number: phone, timezone: 'America/New_York', outreach_paused: false },
    invoice: { id: invoiceId, business_id: businessId, invoice_id: 'TEST-REVIEW', source_provider: source, amount_due_cents: 10000, currency: 'usd', status: 'unpaid', original_due_date: '2026-08-01', inspection_date: '2026-07-01' },
    activeCall: null, paymentLink: null,
  };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('OUTBOUND_ADMIN_TOKEN', 'lock-admin-fixture');
  vi.stubEnv('OUTBOUND_RETELL_AGENT_ID', 'agent_outbound_fixture');
  vi.stubEnv('OUTBOUND_RETELL_CONVERSATION_FLOW_ID', 'conversation_flow_fixture');
  vi.stubEnv('RETELL_FROM_NUMBER', '+19842075346');
  vi.stubEnv('OUTBOUND_ALLOW_AFTER_HOURS_TEST_OVERRIDE', 'true');
  mocks.context.mockResolvedValue(context()); mocks.business.mockResolvedValue(context().business);
  mocks.authorization.mockResolvedValue({ id: authorizationId, business_id: businessId, phone_number: phone, expires_at: '2099-01-01T00:00:00.000Z', revoked_at: null });
  mocks.createAttempt.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000015' });
  mocks.event.mockResolvedValue({}); mocks.updateAttempt.mockResolvedValue({}); mocks.reverify.mockResolvedValue({});
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

function noCallEffects() {
  expect(mocks.phoneCall).not.toHaveBeenCalled();
  expect(mocks.createAuthorization).not.toHaveBeenCalled();
}

describe('business outbound outreach lock', () => {
  it('blocks a valid, unpaused QuickBooks invoice before provider reads or temporary authorization checks', async () => {
    const { inspectOutboundCallEligibility } = await import('../services/outboundCalls');
    const result = await inspectOutboundCallEligibility(invoiceId, now, {
      acknowledged: true, confirmation: 'I UNDERSTAND THIS IS AN AFTER-HOURS TEST', reason: 'self_test',
    }, authorizationId);
    expect(result).toMatchObject({ eligible: false, reason: 'business_outreach_disabled', override_used: false });
    expect(mocks.reverify).not.toHaveBeenCalled(); expect(mocks.authorization).not.toHaveBeenCalled();
    expect(mocks.createAttempt).not.toHaveBeenCalled(); noCallEffects();
  }, 30_000);

  it('blocks the direct call service even when a previously issued demo authorization is supplied', async () => {
    const { startOutboundCall } = await import('../services/outboundCalls');
    await expect(startOutboundCall(invoiceId, undefined, now, undefined, authorizationId)).rejects.toThrow('business_outreach_disabled');
    expect(mocks.createAttempt).not.toHaveBeenCalled(); noCallEffects();
  });

  it('rechecks a lock changed during QuickBooks verification', async () => {
    mocks.context.mockResolvedValueOnce(context(true)).mockResolvedValue(context(false));
    const { inspectOutboundCallEligibility } = await import('../services/outboundCalls');
    expect(await inspectOutboundCallEligibility(invoiceId, now)).toMatchObject({ eligible: false, reason: 'business_outreach_disabled' });
    expect(mocks.reverify).toHaveBeenCalledOnce(); noCallEffects();
  });

  it('rechecks the business immediately before provider call creation and records failure when newly locked', async () => {
    mocks.context.mockResolvedValueOnce(context(true, 'local')).mockResolvedValue(context(false, 'local'));
    const { startOutboundCall } = await import('../services/outboundCalls');
    await expect(startOutboundCall(invoiceId, undefined, now)).rejects.toThrow('business_outreach_disabled');
    expect(mocks.createAttempt).toHaveBeenCalledOnce();
    expect(mocks.updateAttempt).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'error' }));
    noCallEffects();
  });

  it('preserves an explicitly enabled existing demo', async () => {
    const demo = context(true, 'local'); demo.business.is_demo = true;
    mocks.context.mockResolvedValue(demo);
    const { inspectOutboundCallEligibility } = await import('../services/outboundCalls');
    expect(await inspectOutboundCallEligibility(invoiceId, now)).toMatchObject({ eligible: true, reason: 'eligible' });
    noCallEffects();
  });

  it.each([undefined,null])('blocks missing or unknown business lock state (%s)',async enabled=>{
    const demo=context(enabled,'local');demo.business.is_demo=true;
    if(enabled===undefined)delete demo.business.outreach_enabled;
    mocks.context.mockResolvedValue(demo);
    const {inspectOutboundCallEligibility}=await import('../services/outboundCalls');
    expect(await inspectOutboundCallEligibility(invoiceId,now,undefined,authorizationId)).toMatchObject({eligible:false,reason:'business_outreach_disabled'});
    expect(mocks.authorization).not.toHaveBeenCalled();noCallEffects();
  });

  it.each(['/calls/dry-run', '/demo-call/preflight'])('reports the stored lock at %s without placing a call', async path => {
    const { createApp } = await import('../app');
    const response = await request(createApp()).post('/api/outbound' + path).set('Authorization', 'Bearer lock-admin-fixture')
      .send({ invoice_id: invoiceId, demo_call_authorization_id: authorizationId });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ eligible: false, reason: 'business_outreach_disabled', outreach_enabled: false });
    expect(mocks.createAttempt).not.toHaveBeenCalled(); noCallEffects();
  });

  it.each(['/calls/start', '/demo-call/start'])('rejects %s despite a valid previous authorization', async path => {
    const { createApp } = await import('../app');
    const response = await request(createApp()).post('/api/outbound' + path).set('Authorization', 'Bearer lock-admin-fixture')
      .send({ invoice_id: invoiceId, demo_call_authorization_id: authorizationId });
    expect(response.status).toBe(400); expect(response.body.error).toContain('business_outreach_disabled');
    expect(mocks.createAttempt).not.toHaveBeenCalled(); noCallEffects();
  });

  it.each(['test', 'real'])('rejects %s batches even with production mode and the exact confirmation', async mode => {
    const fixture = context(); fixture.business.test_mode = mode !== 'real';
    mocks.context.mockResolvedValue(fixture);
    const { createApp } = await import('../app');
    const response = await request(createApp()).post('/api/outbound/calls/start-batch').set('Authorization', 'Bearer lock-admin-fixture')
      .send({ invoice_ids: [invoiceId], mode, confirmation: 'START_REAL_OUTBOUND_BATCH' });
    expect(response.status).toBe(403); expect(response.body.error).toBe('business_outreach_disabled');
    expect(mocks.createAttempt).not.toHaveBeenCalled(); noCallEffects();
  });

  it('allows a batch review but marks every locked result uncallable', async () => {
    const { createApp } = await import('../app');
    const response = await request(createApp()).post('/api/outbound/calls/start-batch').set('Authorization', 'Bearer lock-admin-fixture')
      .send({ invoice_ids: [invoiceId], mode: 'dry_run' });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([{ invoice_id: invoiceId, eligible: false, reason: 'business_outreach_disabled', called: false }]);
    expect(mocks.createAttempt).not.toHaveBeenCalled(); noCallEffects();
  });

  it('refuses new temporary number authorization for a locked business', async () => {
    const { createApp } = await import('../app');
    const response = await request(createApp()).post('/api/outbound/demo-call/authorize-number').set('Authorization', 'Bearer lock-admin-fixture')
      .send({ business_id: businessId, phone_number: phone, acknowledged: true, confirmation: 'I AUTHORIZE THIS DEMO TEST CALL' });
    expect(response.status).toBe(403); expect(response.body.error).toBe('business_outreach_disabled');
    noCallEffects();
  });

  it('exposes the lock read-only and rejects an attempt to enable it through settings', async () => {
    const { createApp } = await import('../app');
    const app = createApp();
    const read = await request(app).get(`/api/outbound/businesses/${businessId}/settings`).set('Authorization', 'Bearer lock-admin-fixture');
    expect(read.status).toBe(200); expect(read.body.readiness.outreachEnabled).toBe(false);
    const write = await request(app).patch(`/api/outbound/businesses/${businessId}/settings`).set('Authorization', 'Bearer lock-admin-fixture')
      .send({ outreach_enabled: true, test_mode: false, production_mode_confirmation: 'ENABLE PRODUCTION OUTBOUND MODE' });
    expect(write.status).toBe(400); expect(mocks.updateBusiness).not.toHaveBeenCalled(); noCallEffects();
  });
});
