const { test } = require('node:test');
const assert = require('node:assert/strict');
let fail = false;
const events = [];
const conn = {
  beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'),
  rollback: async () => events.push('rollback'), release: () => events.push('release'),
  execute: async sql => {
    events.push(sql);
    if (sql.startsWith('SELECT * FROM flights')) return [[{ flight_id: 1, flight_number: 'SW101', aircraft_id: 1, from_airport_code: 'KHI', to_airport_code: 'ISB', departure_datetime: '2027-01-01T10:00:00', arrival_datetime: '2027-01-01T12:00:00', base_price: 100, business_price: 150, first_class_price: 200, status: 'scheduled' }]];
    if (sql.startsWith('SELECT status FROM aircraft')) return [[{ status: 'active' }]];
    if (sql.startsWith('SELECT airport_code')) return [[{ airport_code: 'KHI' }, { airport_code: 'ISB' }]];
    if (sql.startsWith('SELECT booking_id')) return [[{ booking_id: 1 }, { booking_id: 2 }]];
    return [[]];
  }
};
function mock(path, exports) { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('../backend/config/database', { pool: { getConnection: async () => conn } });
mock('../backend/services/bookingStateMachine', { transitionBookingState: async (_, id) => {
  events.push(`cancel ${id}`); if (fail && id === 2) throw new Error('cascade failed');
} });
const service = require('../backend/services/flightManagementService');
test('flight cancellation commits bookings and holds together', async () => {
  await service.updateFlight(1, { status: 'cancelled' }, { role: 'admin' });
  assert.ok(events.includes('cancel 1') && events.includes('cancel 2'));
  assert.ok(events.some(e => e.includes('UPDATE seat_holds')));
  assert.ok(events.includes('commit'));
});
test('a cascade failure rolls back instead of reporting partial success', async () => {
  events.length = 0; fail = true;
  await assert.rejects(service.updateFlight(1, { status: 'cancelled' }, { role: 'admin' }), /cascade failed/);
  assert.ok(events.includes('rollback'));
  assert.ok(!events.includes('commit'));
});
