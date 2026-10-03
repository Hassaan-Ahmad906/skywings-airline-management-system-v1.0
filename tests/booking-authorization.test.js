const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');

// Exercise real HTTP routing without connecting to the application database.
let databaseCalls = 0;
let historyCalls = 0;
const databasePath = require.resolve('../backend/config/database');
const authPath = require.resolve('../backend/middleware/auth');
require.cache[databasePath] = {
  id: databasePath, filename: databasePath, loaded: true,
  exports: {
    query: async () => { databaseCalls++; return []; },
    queryOne: async (sql, params) => {
      databaseCalls++;
      return params[0] === 1 || params.length === 1 ? { booking_id: params[0], status: 'COMPLETED', user_id: 1 } : null;
    },
    pool: { execute:async()=>[[]], getConnection: async () => { databaseCalls++; throw new Error('Unexpected database access'); } }
  }
};
const historyPath = require.resolve('../backend/repositories/rebookingRepository');
require.cache[historyPath] = {
  id: historyPath, filename: historyPath, loaded: true,
  exports: { getHistoryByBooking: async (connection, bookingId) => { historyCalls++; return [{ booking_id: bookingId }]; } }
};
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    authenticate(req, res, next) {
      if (!req.headers.authorization) return res.status(401).json({ success: false });
      req.user = { userId: 1, role: req.headers.authorization === 'Bearer admin' ? 'admin' : 'user' };
      next();
    },
    requireGateStaff(req, res, next) {
      if (!['admin','crew'].includes(req.user.role)) return res.status(403).json({ success: false });
      next();
    },
    requireAdmin(req, res, next) {
      if (req.user.role !== 'admin') return res.status(403).json({ success: false });
      next();
    }
  }
};

const app = express();
app.use(express.json());
app.use('/api/bookings', require('../backend/routes/bookings'));
app.use('/api/boarding', require('../backend/routes/boarding'));
let server, baseUrl;
before(async () => {
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test('generic booking state writes require authentication', async () => {
  const response = await fetch(`${baseUrl}/api/bookings/1/update-status`, { method: 'POST' });
  assert.equal(response.status, 401);
});

test('customer and admin cannot use legacy route to mutate lifecycle or payment states', async () => {
  for (const actor of ['customer', 'admin']) {
    for (const status of ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'BOARDED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'MISSED', null, {}]) {
      const response = await fetch(`${baseUrl}/api/bookings/1/update-status`, {
        method: 'POST', headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'BOOKING_STATUS_UPDATE_FORBIDDEN');
    }
  }
  assert.equal(databaseCalls, 0, 'rejected transitions must not access or mutate the database');
});

test('gate scanning rejects customers before booking lookup, including another owner booking', async () => {
  const callsBefore = databaseCalls;
  for (const booking_id of [1, 77]) {
    const response = await fetch(`${baseUrl}/api/boarding/scan`, {
      method: 'POST', headers: { Authorization: 'Bearer customer', 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id, gate_number: 'A1' })
    });
    assert.equal(response.status, 403);
  }
  assert.equal(databaseCalls, callsBefore);
});

test('gate scanning still requires authentication and validates authorized staff input', async () => {
  const anonymous = await fetch(`${baseUrl}/api/boarding/scan`, { method: 'POST' });
  assert.equal(anonymous.status, 401);
  const staff = await fetch(`${baseUrl}/api/boarding/scan`, {
    method: 'POST', headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ booking_id: 'invalid' })
  });
  assert.equal(staff.status, 400);
});

test('rebooking history is available only for owned bookings or administrators', async () => {
  for (const [actor, bookingId, expected] of [['customer', 77, 404], ['customer', 1, 200], ['admin', 77, 200]]) {
    const beforeCalls = historyCalls;
    const response = await fetch(`${baseUrl}/api/bookings/${bookingId}/rebook/history`, {
      headers: { Authorization: `Bearer ${actor}` }
    });
    assert.equal(response.status, expected);
    assert.equal(historyCalls - beforeCalls, expected === 200 ? 1 : 0);
  }
  const invalid = await fetch(`${baseUrl}/api/bookings/1junk/rebook/history`, { headers: { Authorization: 'Bearer customer' } });
  assert.equal(invalid.status, 400);
});
