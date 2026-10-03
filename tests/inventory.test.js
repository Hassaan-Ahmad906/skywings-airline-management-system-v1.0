const assert = require('node:assert/strict');
const { test } = require('node:test');
const id = require.resolve('../backend/config/database');
require.cache[id] = { id, filename: id, loaded: true, exports: {} };
const repository = require('../backend/repositories/bookingRepository');
const flight = { flight_id: 1, aircraft_id: 1, capacity: 6 };
function database(total, cabin, capacity, holds = []) {
  return { execute: async (sql, params) => {
    if (sql.includes('SUM(number_of_passengers)')) {
      assert.match(sql, /CHECKED_IN.*BOARDED/);
      assert.match(sql, /reservation_expires_at > NOW\(\)/);
      return [[{ reserved_seats: params[1] ? cabin : total }]];
    }
    if (sql.includes('COUNT(*)')) return [[{ capacity }]];
    return [holds];
  } };
}
test('checked-in/boarded reservations still occupy total capacity', async () => {
  await assert.rejects(repository.assertCapacity(database(6, 3, 6), flight, 'economy', 1), e => e.code === 'CAPACITY_EXCEEDED');
});
test('cabin capacity cannot be replaced with empty seats in another cabin', async () => {
  await assert.rejects(repository.assertCapacity(database(2, 2, 2), flight, 'business', 1), e => e.code === 'CAPACITY_EXCEEDED');
  await repository.assertCapacity(database(2, 1, 2), flight, 'business', 1);
});
test('unexpired holds consume inventory except seats converted in this request', async () => {
  const db = database(5, 5, 6, [{ seat_number: '2A', seat_class: 'economy' }]);
  await assert.rejects(repository.assertCapacity(db, flight, 'economy', 1), e => e.status === 409);
  await repository.assertCapacity(db, flight, 'economy', 1, null, ['2A']);
});
