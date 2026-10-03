const assert = require('node:assert/strict');
const { test } = require('node:test');
const databasePath = require.resolve('../backend/config/database');
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: {} };
const repository = require('../backend/repositories/bookingRepository');

test('existing passenger must belong to booking customer before any link is written', async () => {
  const queries = [];
  const connection = { execute: async (sql, params) => { queries.push({ sql, params }); return [[]]; } };
  await assert.rejects(repository.addPassengerToBooking(connection, 1, 10, { passenger_id: 99 }),
    error => error.status === 403 && error.code === 'PASSENGER_ACCESS_DENIED');
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [99, 10]);
  assert.match(queries[0].sql, /user_id = \? FOR UPDATE/);
});

test('owned saved passenger can be linked without creating a duplicate passenger', async () => {
  const queries = [];
  const connection = { execute: async (sql, params) => {
    queries.push({ sql, params });
    return sql.startsWith('SELECT') ? [[{ passenger_id: 99 }]] : [{ insertId: 2 }];
  } };
  assert.equal(await repository.addPassengerToBooking(connection, 1, 10, { passenger_id: 99, seat_number: '12A' }), 99);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].params, [1, 99, '12A']);
});

test('malformed saved passenger IDs are rejected before database access', async () => {
  const connection = { execute() { throw new Error('Unexpected database access'); } };
  for (const passenger_id of [0, -1, 1.5, 'not-an-id', {}, '']) {
    await assert.rejects(repository.addPassengerToBooking(connection, 1, 10, { passenger_id }),
      error => error.status === 400);
  }
});
