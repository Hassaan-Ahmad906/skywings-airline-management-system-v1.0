const assert = require('node:assert/strict');
const { test } = require('node:test');
let connections = 0;
const dbPath = require.resolve('../backend/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  pool: { getConnection: async () => { connections++; throw new Error('Unexpected database access'); } }
} };
const payment = require('../backend/services/paymentService');
test('demo payment requires explicit opt-in and is always disabled in production', async () => {
  const originalMode = process.env.PAYMENT_MODE, originalEnv = process.env.NODE_ENV;
  try {
    for (const [mode, env] of [['demo', 'production'], ['disabled', 'development'], ['', 'test']]) {
      process.env.PAYMENT_MODE = mode; process.env.NODE_ENV = env;
      assert.equal(payment.demoEnabled(), false);
      await assert.rejects(payment.confirmDemoPayment(1, 1), error => error.status === 503);
    }
    assert.equal(connections, 0);
    process.env.PAYMENT_MODE = 'demo'; process.env.NODE_ENV = 'development';
    assert.equal(payment.demoEnabled(), true);
    await assert.rejects(payment.confirmDemoPayment(1, -1), error => error.status === 400);
  } finally {
    if (originalMode === undefined) delete process.env.PAYMENT_MODE; else process.env.PAYMENT_MODE = originalMode;
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
  }
});
