const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
let version = 0;
const id = require.resolve('../backend/config/database');
require.cache[id] = { id, filename: id, loaded: true, exports: {
  queryOne: async () => ({ user_id: 1, email: 'ali@example.test', role: 'user', status: 'active', token_version: version }),
  query: async sql => { if (sql.includes('token_version = token_version + 1')) version++; return []; }
} };
const auth = require('../backend/middleware/auth');
test('logout invalidates the saved token, including replay from another client', async () => {
  const app = express(); app.use(express.json());
  app.use('/auth', require('../backend/routes/auth'));
  app.get('/private', auth.authenticate, (_, res) => res.json({ success: true }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${auth.generateToken(1, 'ali@example.test', 'user', 0)}` };
  try {
    assert.equal((await fetch(url + '/private', { headers })).status, 200);
    assert.equal((await fetch(url + '/auth/logout', { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(url + '/private', { headers })).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('rejected async requests are handled and internal details are removed; rate limits recover', async () => {
  const app = express(); app.use(require('../backend/middleware/safeErrors'));
  const router = require('../backend/middleware/asyncRouter')();
  router.get('/failure', async () => { throw new Error('SQL password=secret; host=private'); });
  let now = 0;
  router.get('/limited', require('../backend/middleware/rateLimit')({ limit: 2, windowMs: 1000, now: () => now }), (_, res) => res.json({ success: true }));
  app.use(router); app.use((error, req, res, next) => res.status(500).json({ message: error.message, stack: error.stack }));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const failure = await fetch(url + '/failure'); assert.equal(failure.status, 500);
    assert.equal((await failure.text()).includes('secret'), false);
    assert.equal((await fetch(url + '/limited')).status, 200);
    assert.equal((await fetch(url + '/limited')).status, 200);
    const limited = await fetch(url + '/limited'); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '1');
    now = 1001; assert.equal((await fetch(url + '/limited')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
