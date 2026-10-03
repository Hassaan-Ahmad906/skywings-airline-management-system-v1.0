const assert = require('node:assert/strict');
const name = `skywings_test_flow_${process.pid}`;
process.env.DB_NAME = name;
process.env.NODE_ENV = 'test';
process.env.PAYMENT_MODE = 'demo';
process.env.NOTIFICATIONS_ENABLED = 'false';
const setup = require('./databaseSetup');
const db = require('../backend/config/database');
async function main() {
  let server;
  try {
    await setup({ database: name });
    const hash = await require('bcryptjs').hash('TestPass123!', 10);
    for (const [index, first, last, role] of [[1,'Ahmed','Farooq','admin'],[2,'Ali','Raza','user'],[3,'Ayesha','Khan','user']]) {
      await db.pool.execute('INSERT INTO users (user_id, first_name, last_name, email, password, role) VALUES (?, ?, ?, ?, ?, ?)', [index, first, last, `person${index}@example.test`, hash, role]);
    }
    await db.pool.execute("INSERT INTO airports (airport_code, airport_name, city, country) VALUES ('KHI','Jinnah International','Karachi','Pakistan'), ('ISB','Islamabad International','Islamabad','Pakistan')");
    for (const [id,airport] of [[4,'KHI'],[5,'ISB']]) await db.pool.execute("INSERT INTO users (user_id, first_name, last_name, email, password, role, gate_airport_code) VALUES (?, 'Hamza', 'Iqbal', ?, ?, 'crew', ?)", [id, `person${id}@example.test`, hash, airport]);
    await db.pool.execute("INSERT INTO aircraft (aircraft_id, model, registration, capacity, status) VALUES (1,'Test aircraft','AP-TEST',4,'active')");
    for (const [seat, cabin, row, letter] of [['1A','first',1,'A'],['1B','business',1,'B'],['2A','economy',2,'A'],['2B','economy',2,'B']]) {
      await db.pool.execute('INSERT INTO seats (aircraft_id, seat_number, seat_class, `row_number`, column_letter) VALUES (1, ?, ?, ?, ?)', [seat,cabin,row,letter]);
    }
    for (let id = 1; id <= 3; id++) await db.pool.execute(`INSERT INTO flights (flight_id, flight_number, aircraft_id, from_airport_code, to_airport_code, departure_datetime, arrival_datetime, base_price, business_price, first_class_price)
      VALUES (?, ?, 1, 'KHI', 'ISB', DATE_ADD(NOW(), INTERVAL ? HOUR), DATE_ADD(NOW(), INTERVAL ? HOUR), 100, 150, 200)`, [id, 'SW10'+id, id === 1 ? 1 : id*24, id === 1 ? 3 : id*24+2]);
    const app = require('../backend/server'); server = await app.startServer(0);
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const cookies = {};
    async function request(path, actor = 2, body, method = body ? 'POST' : 'GET') {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookies[actor] ? { Cookie: cookies[actor] } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json(); return { status: response.status, data };
    }
    for (const actor of [1,2,3,4,5]) {
      const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `person${actor}@example.test`, password: 'TestPass123!' }) });
      assert.equal(response.status, 200); cookies[actor] = response.headers.get('set-cookie').split(';')[0];
    }
    const holds = await Promise.all([2,3].map(actor => request('/seat-holds', actor, { flight_id: 1, seat_number: '2A', session_id: `session${actor}`, passenger_index: 0 })));
    assert.deepEqual(holds.map(result => result.status).sort(), [201,409]);
    const winner = holds[0].status === 201 ? 2 : 3, loser = winner === 2 ? 3 : 2;
    const passenger = { first_name: 'Hassan', last_name: 'Ahmed', seat_number: '2A', nationality: 'Pakistani' };
    assert.equal((await request('/bookings/create', loser, { flight_id: 1, passengers: [passenger] })).status, 409);
    const body = { flight_id: 1, passengers: [passenger], session_id: `session${winner}`, idempotency_key: 'workflow-booking' };
    const created = await request('/bookings/create', winner, body);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const booking = created.data.data.booking;
    assert.equal(booking.status, 'PENDING'); assert.equal(booking.payment_status, 'pending');
    assert.ok(new Date(booking.reservation_expires_at).getTime() - Date.now() <= 600000);
    const replay = await request('/bookings/create', winner, body);
    assert.equal(replay.data.data.booking.booking_id, booking.booking_id);
    assert.equal((await request(`/bookings/${booking.booking_id}/pay`, loser, {})).status, 404);
    assert.equal((await request(`/bookings/${booking.booking_id}/pay`, winner, {})).status, 200);
    assert.equal((await request(`/bookings/${booking.booking_id}/pay`, winner, {})).status, 200);
    let [tickets] = await db.pool.execute('SELECT * FROM tickets WHERE booking_id = ?', [booking.booking_id]); assert.equal(tickets.length, 1); assert.equal(tickets[0].status, 'ISSUED');
    const checkin = await request('/checkin/confirm', winner, { booking_id: booking.booking_id, seat_numbers: ['2A'] });
    assert.equal(checkin.status, 200, JSON.stringify(checkin.data));
    [tickets] = await db.pool.execute('SELECT * FROM tickets WHERE booking_id = ?', [booking.booking_id]); assert.equal(tickets[0].status, 'ISSUED');
    const pass = await request(`/checkin/boarding-pass/${booking.booking_id}`, winner);
    assert.equal(pass.status, 200); const token = pass.data.data.boardingPass.passengers[0].boarding_token; assert.match(token, /^[a-f0-9]{64}$/);
    const qr = await fetch(base + `/checkin/boarding-code/${booking.booking_id}/${pass.data.data.boardingPass.passengers[0].passenger_id}`, { headers: { Cookie: cookies[winner] } }); assert.equal(qr.status, 200); assert.match(await qr.text(), /<svg/);
    assert.equal((await request('/boarding/scan', loser, { flight_id: 1, boarding_token: token })).status, 403);
    assert.equal((await request('/boarding/flights', 4)).data.data.flights.length, 3);
    assert.equal((await request('/boarding/flights', 5)).data.data.flights.length, 0);
    assert.equal((await request('/boarding/flights/1/manifest', 5)).status, 403);
    assert.equal((await request('/admin/stats', 4)).status, 403);
    assert.equal((await request('/boarding/scan', 4, { flight_id: 1, boarding_token: token, identity_verified:false })).status, 400);
    assert.equal((await request('/boarding/flights/1/gate', 4, { action:'assign', gate_number:'A2' }, 'PATCH')).status, 200);
    assert.equal((await request('/boarding/flights/1/gate', 4, { action:'open' }, 'PATCH')).status, 200);
    assert.equal((await request('/boarding/scan', 5, { flight_id: 1, boarding_token: token, identity_verified:true })).status, 403);
    assert.equal((await request('/boarding/scan', 4, { flight_id: 1, boarding_token: token, identity_verified:true })).status, 200);
    assert.equal((await request('/boarding/scan', 1, { flight_id: 1, boarding_token: token, identity_verified:true })).status, 409);
    const gateAudit = (await request('/boarding/flights/1/audit', 4)).data.data.events;
    assert.ok(gateAudit.some(e => e.action === 'BOARDING_SCAN' && e.outcome === 'accepted'));
    assert.ok(gateAudit.some(e => e.action === 'BOARDING_SCAN' && e.outcome === 'rejected'));
    assert.ok(!JSON.stringify(gateAudit).includes(token));
    [tickets] = await db.pool.execute('SELECT * FROM tickets WHERE booking_id = ?', [booking.booking_id]); assert.equal(tickets[0].status, 'USED');
    const firstClass = await request('/flights/search?from=KHI&to=ISB&class=first&passengers=1');
    assert.equal(firstClass.status, 200); assert.equal(firstClass.data.data.flights[0].available_seats, 1);
    assert.equal(firstClass.data.data.flights[0].price, '200.00');
    assert.equal((await request('/flights/search?passengers=0')).status, 400);
    const expired = await request('/bookings/create', loser, { flight_id: 3, passengers: [{ first_name: 'Fatima', last_name: 'Malik', seat_number: '2B' }] });
    assert.equal(expired.status, 201); const expiredId = expired.data.data.booking.booking_id;
    await db.pool.execute('UPDATE bookings SET reservation_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE booking_id = ?', [expiredId]);
    assert.equal((await request(`/bookings/${expiredId}/pay`, loser, {})).status, 409);
    await require('../backend/services/lifecycleService').runSweep();
    const [expiredRows] = await db.pool.execute('SELECT status FROM bookings WHERE booking_id = ?', [expiredId]); assert.equal(expiredRows[0].status, 'EXPIRED');
    const [allocations] = await db.pool.execute('SELECT * FROM flight_seat_allocations WHERE booking_id = ?', [expiredId]); assert.equal(allocations.length, 0);
    const before = await db.pool.execute('SELECT status FROM bookings ORDER BY booking_id');
    for (const path of ['/admin/stats','/admin/flights','/admin/bookings','/reports/overview','/reports/performance','/reports/revenue','/reports/bookings']) assert.equal((await request(path, 1)).status, 200, path);
    assert.deepEqual((await db.pool.execute('SELECT status FROM bookings ORDER BY booking_id'))[0], before[0]);
    const rebooked = await request('/bookings/create', loser, { flight_id: 2, passengers: [{ first_name: 'Sana', last_name: 'Iqbal', seat_number: '2B' }], idempotency_key: 'rebooking-source' });
    assert.equal(rebooked.status, 201); const sourceId = rebooked.data.data.booking.booking_id;
    await request(`/bookings/${sourceId}/pay`, loser, {});
    const moved = await request(`/bookings/${sourceId}/rebook`, loser, { new_flight_id: 3, rebooking_key: 'move-once', reason: 'CUSTOMER_REQUEST' });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const [mappings] = await db.pool.execute('SELECT seat_number FROM booking_passengers WHERE booking_id = ?', [sourceId]); assert.equal(mappings[0].seat_number, null);
    assert.equal((await request(`/bookings/${sourceId}/rebook`, winner, { new_flight_id: 3, rebooking_key: 'move-once', reason: 'CUSTOMER_REQUEST' })).status, 403);
    assert.equal((await request(`/bookings/${sourceId}/rebook`, loser, { new_flight_id: 3, rebooking_key: 'move-once', reason: 'CUSTOMER_REQUEST' })).status, 200);
    const [flightRows] = await db.pool.execute('SELECT departure_datetime FROM flights WHERE flight_id = 2');
    assert.equal((await request('/admin/flights/2', 1, { arrival_datetime: new Date(flightRows[0].departure_datetime.getTime() - 60000).toISOString() }, 'PUT')).status, 400);
    const unpaid = await request('/bookings/create', winner, { flight_id: 3, passengers: [{ first_name: 'Bilal', last_name: 'Hussain', seat_number: '2A' }] });
    assert.equal(unpaid.status, 201); const unpaidId = unpaid.data.data.booking.booking_id;
    const disruption = await request('/admin/disruptions/execute', 1, { flight_id: 3, disruption_type: 'CANCELLATION', reason: 'Fixture cancellation for atomicity check', execution_key: 'cancel-once' });
    assert.equal(disruption.status, 200, JSON.stringify(disruption.data));
    const [cancelled] = await db.pool.execute('SELECT booking_id, status, payment_status, refund_status FROM bookings WHERE booking_id IN (?, ?) ORDER BY booking_id', [sourceId, unpaidId]);
    assert.equal(cancelled[0].status, 'CANCELLED'); assert.equal(cancelled[0].payment_status, 'refunded'); assert.equal(cancelled[0].refund_status, 'completed');
    assert.equal(cancelled[1].status, 'CANCELLED'); assert.equal(cancelled[1].payment_status, 'pending'); assert.equal(cancelled[1].refund_status, 'none');
    const [notificationRows] = await db.pool.execute('SELECT notification_status FROM disruption_affected_passengers');
    assert.equal(notificationRows.length, 2); assert.ok(notificationRows.every(row => row.notification_status === 'PENDING'));
    assert.equal((await request('/reports/performance', 1)).data.data.customerSatisfaction.average, null);
    const contact = await request('/contact', loser, { name: 'Sana Iqbal', email: 'sana@example.test', category: 'feedback', message: 'Please assist with my reservation.' }); assert.equal(contact.status, 201);
    assert.equal((await request('/contact', loser)).status, 403); assert.equal((await request('/contact', 1)).data.data.messages.length, 1);
    const messageId = contact.data.data.message_id;
    assert.equal((await request(`/contact/${messageId}`, loser, undefined, 'DELETE')).status, 403);
    assert.equal((await request(`/contact/${messageId}`, 1, { status: 'resolved' }, 'PATCH')).status, 200);
    assert.equal((await request('/contact?status=resolved&q=Sana', 1)).data.data.total, 1);
    assert.equal((await request(`/contact/${messageId}`, 1, undefined, 'DELETE')).status, 200);
    assert.equal((await request('/contact', 1)).data.data.total, 0);
    assert.equal((await request('/contact?status=trash', 1)).data.data.total, 1);
    assert.equal((await request(`/contact/${messageId}/restore`, 1, {})).status, 200);
    assert.equal((await request('/contact', 1)).data.data.total, 1);
    assert.equal((await request('/users/password', loser, { currentPassword: 'TestPass123!', newPassword: 'TestPass456!', confirmPassword: 'TestPass456!' }, 'PUT')).status, 200);
    assert.equal((await request('/auth/check', loser)).status, 401);
    console.log('Disposable MySQL workflows passed: hold concurrency, ownership, idempotency, demo confirmation, check-in, QR, boarding/replay, expiry/release, read-only reports, rebooking and contact storage.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.pool.end();
    const connection = await setup.openConnection();
    try { if (!/^skywings_test_flow_\d+$/.test(name)) throw new Error('Unsafe test cleanup target'); await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); }
    finally { await connection.end(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
