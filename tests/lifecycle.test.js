const { test } = require('node:test');
const assert = require('node:assert/strict');
const transitions = [];
let committed = false;
const connection = {
  beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release: () => {},
  execute: async sql => sql.includes('SELECT b.booking_id') ? [[
    { booking_id: 1, status: 'CONFIRMED', departed: 1 },
    { booking_id: 2, status: 'CHECKED_IN', departed: 1 },
    { booking_id: 3, status: 'PENDING', expired: 1 },
    { booking_id: 4, status: 'BOARDED', flight_status: 'completed' },
    { booking_id: 5, status: 'BOARDED', flight_status: 'in_air' }
  ]] : [[]]
};
function mock(path, exports) { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('../backend/config/database', { pool: { execute: async () => [[{ flight_id: 1 }]], getConnection: async () => connection } });
mock('../backend/services/bookingStateMachine', { transitionBookingState: async (conn, id, target) => transitions.push([id, target]) });
test('scheduled lifecycle expires reservations and records no-shows without inventing boarding', async () => {
  await require('../backend/services/lifecycleService').runSweep();
  assert.deepEqual(transitions, [[1, 'MISSED'], [2, 'MISSED'], [3, 'EXPIRED'], [4, 'COMPLETED']]);
  assert.equal(committed, true);
});
