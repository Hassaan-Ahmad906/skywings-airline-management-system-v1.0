const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require.resolve('../backend/config/database');
require.cache[db] = { id: db, filename: db, loaded: true, exports: {} };
const { validateFlight } = require('../backend/services/flightManagementService');
const current = { flight_number: 'SW101', aircraft_id: 1, from_airport_code: 'KHI', to_airport_code: 'ISB', departure_datetime: '2027-01-01T10:00:00', arrival_datetime: '2027-01-01T12:00:00', base_price: 100, business_price: 150, first_class_price: 200, status: 'scheduled' };
test('validation applies to merged partial schedules and rejects invalid or negative fares', () => {
  assert.throws(() => validateFlight({ ...current, departure_datetime: '2027-01-01T13:00:00' }), /Arrival/);
  assert.throws(() => validateFlight({ ...current, arrival_datetime: 'invalid' }), /Arrival/);
  for (const value of [-1, Infinity, 'bad', '', null]) assert.throws(() => validateFlight({ ...current, base_price: value }), /fares/);
  assert.equal(validateFlight({ ...current, base_price: 0 }).base_price, 0);
  assert.throws(() => validateFlight({ ...current, from_airport_code: 'ISB' }), /different/);
});
