const assert = require('node:assert/strict');
const { accounts: demoAccounts } = require('../backend/config/demoSeed');
const name = `skywings_test_seed_${process.pid}`;
process.env.DB_NAME = name; process.env.NODE_ENV = 'test'; process.env.PAYMENT_MODE = 'demo'; process.env.NOTIFICATIONS_ENABLED = 'false';
const setup = require('./databaseSetup');
const db = require('../backend/config/database');
async function comparePublicDemo() {
  // Read the hosted fixture only. Never copy its rows or reset either application.
  const queries = {
    users: "SELECT first_name,last_name,email,role,gate_airport_code,status,DATE_FORMAT(date_of_birth,'%Y-%m-%d') AS dob,address FROM SCHEMA.users ORDER BY email",
    airports: 'SELECT airport_code,airport_name,city,country FROM SCHEMA.airports ORDER BY airport_code',
    aircraft: 'SELECT model,registration,capacity,status FROM SCHEMA.aircraft ORDER BY registration',
    seats: 'SELECT a.registration,s.seat_number,s.seat_class,s.row_number,s.column_letter FROM SCHEMA.seats s JOIN SCHEMA.aircraft a ON a.aircraft_id=s.aircraft_id ORDER BY a.registration,s.seat_number',
    flights: 'SELECT f.flight_number,a.registration,f.from_airport_code,f.to_airport_code,f.base_price,f.business_price,f.first_class_price,f.status,TIMESTAMPDIFF(MINUTE,f.departure_datetime,f.arrival_datetime) AS duration FROM SCHEMA.flights f JOIN SCHEMA.aircraft a ON a.aircraft_id=f.aircraft_id ORDER BY f.flight_number',
    savedPassengers: "SELECT u.email,p.first_name,p.last_name,DATE_FORMAT(p.date_of_birth,'%Y-%m-%d') AS dob,p.passport_number,p.nationality FROM SCHEMA.passengers p JOIN SCHEMA.users u ON u.user_id=p.user_id WHERE p.is_saved=1 ORDER BY u.email,p.passport_number",
    bookings: 'SELECT u.email,f.flight_number,b.class,b.number_of_passengers,b.total_amount FROM SCHEMA.bookings b JOIN SCHEMA.users u ON u.user_id=b.user_id JOIN SCHEMA.flights f ON f.flight_id=b.flight_id ORDER BY u.email,f.flight_number,b.class',
    feedback: 'SELECT name,email,category,message FROM SCHEMA.contact_messages ORDER BY email,message'
  };
  for (const [table, sql] of Object.entries(queries)) {
    const [local] = await db.pool.query(sql.replaceAll('SCHEMA.', ''));
    const [hosted] = await db.pool.query(sql.replaceAll('SCHEMA.', '`skywings_public_demo`.'));
    assert.deepEqual(local, hosted, `Local/hosted demo ${table} fixtures differ`);
  }
  const [hostedAccounts] = await db.pool.query('SELECT email,role,password FROM skywings_public_demo.users');
  for (const account of hostedAccounts) assert.ok(await require('bcryptjs').compare(demoAccounts[account.role].password, account.password), `Hosted sample password differs: ${account.email}`);
  console.log('Local and hosted demo parity verified: all 14 credentials, profiles, airports, aircraft, seats, flight routes/fares/durations, booking amounts and feedback match. Dates, random identifiers and time-driven booking states are intentionally deployment-specific.');
}
async function main() {
  let server;
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
    if (process.argv.includes('--compare-public-demo')) await comparePublicDemo();
    server = await require('../backend/server').startServer(0);
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;
    async function request(endpoint, body, cookie) {
      const response = await fetch(base+endpoint, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type':'application/json', ...(cookie ? { Cookie:cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status:response.status, data:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0] };
    }
    const [accounts] = await db.pool.execute('SELECT user_id,email,role FROM users ORDER BY user_id');
    for (const account of accounts) {
      const credentials = { email:account.email, password:demoAccounts[account.role].password };
      const login = await request('/login',credentials);
      assert.equal(login.status,200,`Fresh seeded account login failed: ${account.email}`);
      const session = await request('/check',undefined,login.cookie);
      assert.equal(session.status,200); assert.equal(session.data.data.user.userId,account.user_id);
      assert.equal(session.data.data.user.role,account.role);
      assert.equal((await request('/logout',{},login.cookie)).status,200);
      assert.equal((await request('/check',undefined,login.cookie)).status,401);
      // Re-login the three portal accounts; keep this single-client smoke test
      // below the real 20-attempt limit instead of weakening login protection.
      if(account.role !== 'user' || account.email === demoAccounts.user.email) {
        const relogin = await request('/login',credentials);
        assert.equal(relogin.status,200,`Seeded account re-login failed: ${account.email}`);
        assert.equal((await request('/logout',{},relogin.cookie)).status,200);
      }
    }
    const credentials = { email:'new.seed.customer@example.test', password:'FreshSignup123!' };
    const registered = await request('/register',{firstName:'Hassan',lastName:'Akram',...credentials,confirmPassword:credentials.password});
    assert.equal(registered.status,201);
    assert.equal((await request('/check',undefined,registered.cookie)).status,200);
    assert.equal((await request('/logout',{},registered.cookie)).status,200);
    const login = await request('/login',credentials); assert.equal(login.status,200);
    const session = await request('/check',undefined,login.cookie); assert.equal(session.status,200);
    assert.equal(session.data.data.user.email,credentials.email); assert.equal(session.data.data.user.role,'user');
    assert.equal((await request('/logout',{},login.cookie)).status,200);
    console.log('Pakistani seed verified: counts, lifecycle states, valid cabin seats, aircraft schedules and safe repeat execution.');
    console.log('Fresh seed login verified: all 14 accounts authenticate, preserve roles, logout and reject revoked sessions; admin/customer/crew portal accounts and a newly registered Pakistani customer log back in after logout.');
  } finally {
    require('../backend/services/seatHoldCleaner').stop();
    if(server) await new Promise(resolve=>server.close(resolve));
    await db.pool.end();
    const connection = await setup.openConnection();
    try { if (!/^skywings_test_seed_\d+$/.test(name)) throw new Error('Unsafe cleanup target'); await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await connection.end(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
