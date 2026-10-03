const { test } = require('node:test');
const assert = require('node:assert/strict');
const token = 'a'.repeat(64);
let replay = false, remaining = 1, transitioned = 0, commits = 0, rollbacks = 0;
const conn = {
  beginTransaction: async () => {}, commit: async () => commits++, rollback: async () => rollbacks++, release() {},
  execute: async (sql, params) => {
    if (sql.startsWith('SELECT * FROM flights')) return [[{ status: 'boarding', departure_datetime: new Date(Date.now() + 3600000) }]];
    if (sql.includes('WHERE bp.boarding_token')) return [params[1] === 1 ? [{ booking_id: 1, booking_passenger_id: 1, passenger_id: 1, status: 'CHECKED_IN', boarded_at: replay ? new Date() : null }] : []];
    if (sql.includes('AS remaining')) return [[{ remaining }]];
    if (sql.includes("status = 'ISSUED'")) return [[{ ticket_id: 1 }]];
    return [[]];
  }
};
function mock(path, exports) { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('../backend/config/database', { pool: { getConnection: async () => conn } });
mock('../backend/services/bookingStateMachine', { transitionBookingState: async () => transitioned++ });
mock('../backend/services/ticketService', { updateTicketStatus: async () => {} });
const service = require('../backend/services/boardingService');
test('individual scan does not claim the whole party boarded until all passengers are recorded', async () => {
  const first = await service.scan(token, 1, { role: 'admin' });
  assert.equal(first.all_boarded, false); assert.equal(transitioned, 0);
  remaining = 0;
  const last = await service.scan(token, 1, { role: 'admin' });
  assert.equal(last.all_boarded, true); assert.equal(transitioned, 1); assert.equal(commits, 2);
});
test('replayed and wrong-flight tokens are rejected without committing', async () => {
  replay = true;
  await assert.rejects(service.scan(token, 1, { role: 'admin' }), /already boarded/);
  await assert.rejects(service.scan(token, 2, { role: 'admin' }), /does not match/);
  assert.equal(rollbacks, 2); assert.equal(commits, 2);
});
