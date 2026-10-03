const assert = require('node:assert/strict');
const { test } = require('node:test');
let booking, lookups = 0, deliveries = 0;
for (const [name, exports] of [
  ['../backend/repositories/bookingRepository', { getCompleteBookingDetails: async () => { lookups++; return booking; } }],
  ['../backend/services/auditService', { logEvent: async () => {} }]
]) {
  const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports };
}
const service = require('../backend/services/emailWebhookService');
service.postJson = async () => { deliveries++; return { statusCode: 200 }; };
test('external email is opt-in and requires confirmed real payment', async () => {
  process.env.NODE_ENV = 'development'; delete process.env.NOTIFICATIONS_ENABLED;
  delete process.env.N8N_BOOKING_EMAIL_WEBHOOK_URL;
  assert.equal((await service.triggerPaymentConfirmationWebhook(1)).reason, 'DELIVERY_DISABLED');
  assert.equal(lookups, 0);
  process.env.NOTIFICATIONS_ENABLED = 'true'; process.env.N8N_BOOKING_EMAIL_WEBHOOK_URL = 'https://example.invalid/webhook';
  for (const [status, payment_status, payment_method] of [
    ['CONFIRMED', 'pending', 'Card'], ['CANCELLED', 'paid', 'Card'], ['CONFIRMED', 'paid', 'Demo']
  ]) {
    booking = { status, payment_status, payment_method };
    assert.equal((await service.triggerPaymentConfirmationWebhook(1)).reason, 'PAYMENT_NOT_CONFIRMED');
  }
  assert.equal(deliveries, 0);
  booking = { status: 'CONFIRMED', payment_status: 'paid', payment_method: 'Card', passengers: [], tickets: [] };
  assert.equal((await service.triggerPaymentConfirmationWebhook(1)).success, true);
  assert.equal(deliveries, 1);
  process.env.NODE_ENV = 'test';
  assert.equal((await service.triggerPaymentConfirmationWebhook(1)).reason, 'DELIVERY_DISABLED');
});
