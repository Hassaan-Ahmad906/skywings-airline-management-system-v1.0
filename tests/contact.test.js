const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
let saved = [];
function mock(path, exports) { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('../backend/config/database', { pool: { execute: async (_, values) => { saved.push(values); return [{ insertId: 4 }]; } } });
mock('../backend/middleware/auth', { authenticate: (_, res) => res.sendStatus(401), requireAdmin: (_, res) => res.sendStatus(403) });
test('contact reports success only after durable storage and rejects invalid input', async () => {
  const app = express(); app.use(express.json()); app.use('/contact', require('../backend/routes/contact'));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const url = `http://127.0.0.1:${server.address().port}/contact`;
  try {
    const valid = { name: 'Ayesha Khan', email: 'ayesha@example.test', category: 'feedback', message: 'Please help me with my reservation.' };
    const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...valid, email: 'bad' }) });
    assert.equal(invalid.status, 400); assert.equal(saved.length, 0);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid) });
    assert.equal(response.status, 201); assert.equal((await response.json()).data.message_id, 4);
    assert.deepEqual(saved[0], Object.values(valid));
    assert.equal((await fetch(url)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
