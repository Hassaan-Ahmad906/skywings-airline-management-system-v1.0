const assert = require('node:assert/strict');
const { test } = require('node:test');
const id = require.resolve('../backend/config/database');
require.cache[id] = { id, filename: id, loaded: true, exports: {} };
const seats = require('../backend/repositories/seatRepository');
const holds = require('../backend/repositories/seatHoldRepository');
test('final allocation refuses another customer active hold before creating a seat assignment', async () => {
  let insertions = 0;
  const db = { execute: async sql => {
    if (sql.startsWith('INSERT')) insertions++;
    return sql.includes('SELECT user_id FROM seat_holds') ? [[{ user_id: 2 }]] : [[]];
  } };
  await assert.rejects(seats.allocateSeat(db, 1, '12A', 1, 1), e => e.status === 409);
  assert.equal(insertions, 0);
});
test('retrying an owned hold returns the same hold without extending or duplicating it', async () => {
  const queries = [];
  const db = { execute: async sql => { queries.push(sql); return sql.includes('SELECT * FROM seat_holds') ? [[{ hold_id: 5 }]] : [[]]; } };
  const result = await holds.createOrUpdateHold(db, { flightId: 1, seatNumber: '12A', userId: 1, sessionId: 'session', passengerIndex: 0 });
  assert.equal(result.hold_id, 5);
  assert.equal(queries.some(sql => sql.startsWith('INSERT')), false);
});
test('booking hold lookup is scoped to flight as well as user and session', async () => {
  const db = { execute: async (sql, params) => { assert.deepEqual(params, ['session', 1, 2]); assert.match(sql, /flight_id = \?/); return [[]]; } };
  await holds.findActiveHoldsBySession(db, 'session', 1, 2);
});
