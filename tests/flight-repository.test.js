const { test } = require('node:test');
const assert = require('node:assert/strict');
const id = require.resolve('../backend/config/database');
require.cache[id] = { id, filename: id, loaded: true, exports: { query: async (_, values) => values[0] === 1 ? [{ flight_id: 1 }] : [] } };
const repository = require('../backend/repositories/flightRepository');
test('flight repository returns the database row and null for a missing flight', async () => {
  assert.deepEqual(await repository.findById(1), { flight_id: 1 });
  assert.equal(await repository.findById(2), null);
});
