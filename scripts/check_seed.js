const assert = require('node:assert/strict');
const name = `skywings_test_seed_${process.pid}`;
process.env.DB_NAME = name; process.env.NODE_ENV = 'test'; process.env.PAYMENT_MODE = 'demo'; process.env.NOTIFICATIONS_ENABLED = 'false';
const setup = require('./databaseSetup');
const db = require('../backend/config/database');
async function main() {
  try {
    await setup({ database: name });
    await require('./seed_database')();
    const [[counts]] = await db.pool.execute('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM flights) AS flights, (SELECT COUNT(*) FROM seats) AS seats, (SELECT COUNT(*) FROM bookings) AS bookings');
    assert.deepEqual([counts.users, counts.flights, counts.seats, counts.bookings], [14,63,288,19]);
    const [states] = await db.pool.execute('SELECT DISTINCT status FROM bookings');
    for (const state of ['PENDING','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','EXPIRED','MISSED']) assert.ok(states.some(row => row.status === state), state);
    const [broken] = await db.pool.execute(`SELECT bp.booking_id FROM booking_passengers bp JOIN bookings b ON b.booking_id = bp.booking_id JOIN flights f ON f.flight_id = b.flight_id
      LEFT JOIN seats s ON s.aircraft_id = f.aircraft_id AND s.seat_number = bp.seat_number AND s.seat_class = b.class
      WHERE bp.seat_number IS NOT NULL AND s.seat_id IS NULL`); assert.equal(broken.length, 0);
    const [overlaps] = await db.pool.execute(`SELECT a.flight_id, b.flight_id FROM flights a JOIN flights b ON a.aircraft_id = b.aircraft_id AND a.flight_id < b.flight_id
      WHERE a.status <> 'cancelled' AND b.status <> 'cancelled' AND a.departure_datetime < b.arrival_datetime AND b.departure_datetime < a.arrival_datetime`); assert.equal(overlaps.length, 0);
    assert.equal((await require('./seed_database')()).skipped, true);
    console.log('Pakistani seed verified: counts, lifecycle states, valid cabin seats, aircraft schedules and safe repeat execution.');
  } finally {
    await db.pool.end();
    const connection = await setup.openConnection();
    try { if (!/^skywings_test_seed_\d+$/.test(name)) throw new Error('Unsafe cleanup target'); await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await connection.end(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
