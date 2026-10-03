const assert = require('node:assert/strict');
const name = `skywings_test_tidb_seed_${process.pid}`;
process.env.DB_NAME = name;
process.env.NODE_ENV = 'test';
process.env.NOTIFICATIONS_ENABLED = 'false';
const setup = require('./databaseSetup');
const db = require('../backend/config/database');
const { rowDigest } = require('./backup_database');
const { prepareAccounts,reseedPreservingHistory } = require('./seed_tidb');
async function snapshot(connection) {
  const [tables] = await connection.query('SHOW TABLES');
  const manifest = { database:name,tables:{} };
  for (const entry of tables) {
    const table = Object.values(entry)[0];
    const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
    manifest.tables[table] = { count:rows.length,digest:rowDigest(rows) };
  }
  return manifest;
}
async function main() {
  await setup({ database:name });
  const connection = await db.pool.getConnection();
  try {
    const accounts = await prepareAccounts();
    const [user] = await connection.execute("INSERT INTO users (first_name,last_name,email,password,role) VALUES ('Old','Sample','old@example.com',?,'admin')",[accounts[0].hash]);
    await connection.execute("INSERT INTO airports (airport_code,airport_name,city,country) VALUES ('KHI','Sample KHI','Karachi','Pakistan'),('ISB','Sample ISB','Islamabad','Pakistan')");
    const [plane] = await connection.execute("INSERT INTO aircraft (model,registration,capacity,status) VALUES ('Old sample','AP-OLD',1,'active')");
    await connection.execute("INSERT INTO seats (aircraft_id,seat_number,seat_class,`row_number`,column_letter) VALUES (?,'1A','economy',1,'A')",[plane.insertId]);
    for(let index=0;index<3;index++) {
      const [extra]=await connection.execute("INSERT INTO aircraft (model,registration,capacity,status) VALUES ('Sample',?,99,'active')",[`AP-EX${index}`]);
      await connection.execute("INSERT INTO seats (aircraft_id,seat_number,seat_class,`row_number`,column_letter) VALUES (?,'1A','economy',1,'A')",[extra.insertId]);
    }
    const [flight] = await connection.execute("INSERT INTO flights (flight_number,aircraft_id,from_airport_code,to_airport_code,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) VALUES ('SW-OLD',?,'KHI','ISB',DATE_ADD(NOW(),INTERVAL 1 DAY),DATE_ADD(NOW(),INTERVAL 2 DAY),1,2,3)",[plane.insertId]);
    const [booking] = await connection.execute("INSERT INTO bookings (booking_reference,user_id,flight_id,number_of_passengers,class,total_amount,status,payment_status) VALUES ('OLD-REFERENCE',?,?,1,'economy',1,'COMPLETED','paid')",[user.insertId,flight.insertId]);
    const [passenger] = await connection.execute("INSERT INTO passengers (user_id,first_name,last_name) VALUES (?,'Old','Passenger')",[user.insertId]);
    const [ticket] = await connection.execute("INSERT INTO tickets (ticket_number,booking_id,passenger_id,flight_id,seat_number,cabin_class) VALUES ('OLD-TICKET',?,?,?,'1A','economy')",[booking.insertId,passenger.insertId,flight.insertId]);
    await connection.execute("INSERT INTO ticket_audit_logs (ticket_id,new_status,changed_by_user_id) VALUES (?,'ISSUED',?)",[ticket.insertId,user.insertId]);
    await connection.execute("INSERT INTO flights (flight_number,aircraft_id,from_airport_code,to_airport_code,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) VALUES ('SW-UNREFERENCED',?,'KHI','ISB',DATE_ADD(NOW(),INTERVAL 1 DAY),DATE_ADD(NOW(),INTERVAL 2 DAY),1,2,3)",[plane.insertId]);
    const original = await snapshot(connection);
    const wrong = structuredClone(original); wrong.tables.users.digest = 'changed';
    await assert.rejects(reseedPreservingHistory(connection,wrong,accounts),/Records changed since backup/);
    assert.deepEqual(await snapshot(connection),original);
    const duplicate = accounts.map(account => ({ ...account })); duplicate[1].email = duplicate[0].email;
    await assert.rejects(reseedPreservingHistory(connection,original,duplicate),error => error.code === 'ER_DUP_ENTRY');
    assert.deepEqual(await snapshot(connection),original,'Failed seed must restore all deleted records');
    const result = await reseedPreservingHistory(connection,original,accounts);
    assert.deepEqual(result,{ retiredAccounts:1,createdAccounts:14,removedUnreferencedFlights:1,preservedFlights:1,createdFlights:240,preservedBookings:1,preservedTickets:1,seats:4 });
    const [[counts]] = await connection.query('SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM flights) AS flights,(SELECT COUNT(*) FROM seats) AS seats,(SELECT COUNT(*) FROM bookings) AS bookings,(SELECT COUNT(*) FROM tickets) AS tickets');
    assert.deepEqual(counts,{ users:15,flights:241,seats:4,bookings:1,tickets:1 });
    const [overlaps] = await connection.query("SELECT a.flight_id FROM flights a JOIN flights b ON a.aircraft_id=b.aircraft_id AND a.flight_id<b.flight_id WHERE a.departure_datetime < DATE_ADD(b.arrival_datetime,INTERVAL 30 MINUTE) AND b.departure_datetime < DATE_ADD(a.arrival_datetime,INTERVAL 30 MINUTE)");
    assert.equal(overlaps.length,0);
    const [capacities] = await connection.query('SELECT a.aircraft_id FROM aircraft a LEFT JOIN seats s ON s.aircraft_id=a.aircraft_id GROUP BY a.aircraft_id,a.capacity HAVING COUNT(s.seat_id)<>a.capacity');
    assert.equal(capacities.length,0);
    assert.deepEqual((await snapshot(connection)).tables.schema_migrations,original.tables.schema_migrations);
    for(const table of ['bookings','tickets','ticket_audit_logs']) assert.deepEqual((await snapshot(connection)).tables[table],original.tables[table]);
    const [[retired]]=await connection.execute('SELECT status,token_version FROM users WHERE user_id=?',[user.insertId]);
    assert.equal(retired.status,'inactive'); assert.equal(retired.token_version,1);
    const priorMode = process.env.NODE_ENV; process.env.NODE_ENV='production';
    try { await require('../backend/services/productionGuard').verify(db.pool); } finally { process.env.NODE_ENV=priorMode; }
    const [users] = await connection.query('SELECT email,password FROM users');
    for (const account of accounts) assert.ok(await require('bcryptjs').compare(account.password,users.find(user => user.email===account.email).password));
    console.log('TiDB reseed verified: backup drift refusal, full rollback after duplicate-account failure, preservation of bookings/payment/ticket audit records and referenced flights, retired old login, unchanged migrations, unique valid passwords, production guard, 240 new flights without overlap and matching seat capacities.');
  } finally { connection.release(); }
}
main().catch(error => { console.error(error.code === 'ERR_ASSERTION' ? error.stack : error.code ? `Seed verification failed (${error.code})` : error.message); process.exitCode=1; }).finally(async() => {
  await db.pool.end();
  const connection = await setup.openConnection();
  try { if(!/^skywings_test_tidb_seed_\d+$/.test(name)) throw new Error('Unsafe cleanup'); await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await connection.end(); }
});
