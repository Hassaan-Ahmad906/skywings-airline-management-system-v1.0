const { test } = require('node:test');
const assert = require('node:assert/strict');
let statuses = [], delivered = 0, fail = false;
function mock(path, exports) { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('../backend/repositories/disruptionRepository', { getPendingNotifications: async () => [{ affected_id: 1 }], updateNotificationStatus: async (_, id, status) => statuses.push(status) });
mock('../backend/services/emailWebhookService', { postJson: async () => { delivered++; if (fail) throw new Error('gateway unavailable'); } });
const worker = require('../backend/workers/disruptionNotificationWorker');
test('disabled delivery leaves notifications pending, and SENT requires gateway success', async () => {
  process.env.NOTIFICATIONS_ENABLED = 'false';
  assert.equal((await worker.processPendingNotifications()).disabled, true); assert.equal(delivered, 0);
  process.env.NOTIFICATIONS_ENABLED = 'true'; process.env.NODE_ENV = 'development'; process.env.DISRUPTION_NOTIFICATION_WEBHOOK_URL = 'https://notification.example.test';
  fail = true; await worker.processPendingNotifications(); assert.deepEqual(statuses, ['FAILED']);
  fail = false; await worker.processPendingNotifications(); assert.deepEqual(statuses, ['FAILED', 'SENT']);
});
