const fs = require('fs');
const assert = require('node:assert/strict');
const setup = require('./databaseSetup');
async function checkSchema() {
  const connection = await setup.openConnection();
  const names = [`skywings_test_schema_${process.pid}`, `skywings_test_upgrade_${process.pid}`];
  try {
    for (const [index, name] of names.entries()) {
      if (!/^skywings_test_(schema|upgrade)_\d+$/.test(name)) throw new Error('Unsafe test database target');
      await connection.query(`CREATE DATABASE \`${name}\``);
      await connection.query(`USE \`${name}\``);
      if (index === 1) {
        const legacy = fs.readFileSync(require('path').join(__dirname, '../tests/fixtures/legacy-schema.sql'), 'utf8')
          .replace(/^CREATE DATABASE[^;]+;/m, '').replace(/^USE[^;]+;/m, '');
        await connection.query(legacy);
        await assert.rejects(require('../backend/services/schemaReadiness').verify(connection), error => error.code === 'DATABASE_MIGRATION_REQUIRED');
        await connection.query("INSERT INTO users (first_name,last_name,email,password) VALUES ('Ali','Raza','legacy@example.test','fixture')");
        await connection.query("INSERT INTO airports (airport_code,airport_name,city,country) VALUES ('KHI','Karachi','Karachi','Pakistan'),('ISB','Islamabad','Islamabad','Pakistan')");
        await connection.query("INSERT INTO aircraft (model,registration,capacity) VALUES ('Fixture','AP-LEG',1)");
        await connection.query("INSERT INTO flights (flight_number,aircraft_id,from_airport_code,to_airport_code,departure_datetime,arrival_datetime,base_price,business_price,first_class_price) VALUES ('SW-LEG',1,'KHI','ISB',DATE_ADD(NOW(),INTERVAL 1 DAY),DATE_ADD(NOW(),INTERVAL 26 HOUR),100,150,200)");
        await connection.query("INSERT INTO bookings (booking_reference,user_id,flight_id,number_of_passengers,class,total_amount) VALUES ('LEGACY-KEEP',1,1,1,'economy',100)");
      }
      await setup({ database: name });
      await setup({ database: name });
      await require('../backend/services/schemaReadiness').verify(connection);
      if (index === 1) {
        const [[preserved]] = await connection.query("SELECT booking_reference,total_amount,status,reservation_expires_at > NOW() AS deadline_valid FROM bookings WHERE booking_reference = 'LEGACY-KEEP'");
        assert.equal(preserved.booking_reference, 'LEGACY-KEEP');
        assert.equal(Number(preserved.total_amount), 100);
        assert.equal(preserved.status, 'PENDING');
        assert.equal(preserved.deadline_valid, 1);
        // Reproduce the Render failure on a database whose earlier migrations were already recorded.
        await connection.query('ALTER TABLE bookings DROP COLUMN reservation_expires_at');
        await assert.rejects(require('../backend/services/schemaReadiness').verify(connection), error => error.message.includes('bookings.reservation_expires_at'));
        await connection.execute('DELETE FROM schema_migrations WHERE version = ?', ['011_reservation_expiry_repair.js']);
        await setup({ database: name });
        await require('../backend/services/schemaReadiness').verify(connection);
        const [[repaired]] = await connection.query("SELECT booking_reference,total_amount,reservation_expires_at > NOW() AS deadline_valid FROM bookings WHERE booking_reference = 'LEGACY-KEEP'");
        assert.equal(repaired.booking_reference, 'LEGACY-KEEP');
        assert.equal(Number(repaired.total_amount), 100);
        assert.equal(repaired.deadline_valid, 1);
        console.log('Render expiry-column recovery passed; existing booking preserved.');
      }
      for (const [table, columns] of Object.entries({
        seat_holds: ['released_at', 'updated_at', 'active_flag'], tickets: ['created_at', 'issue_timestamp'],
        ticket_audit_logs: ['changed_at'], booking_rebooking_history: ['old_flight_id', 'rebooking_key'],
        flight_disruptions: ['execution_started_at', 'operational_notes'],
        disruption_affected_passengers: ['notification_attempts'], bookings: ['reservation_expires_at','itinerary_id','segment_index'], users: ['token_version','gate_airport_code'],
        flights:['gate_number','boarding_open'], contact_messages:['deleted_at'], gate_audit_events:['outcome','actor_user_id'], itineraries:['request_hash','trip_type']
      })) {
        const [rows] = await connection.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [name, table]);
        for (const column of columns) assert(rows.some(row => row.COLUMN_NAME === column), `${name}.${table}.${column}`);
      }
      const [indexes] = await connection.query('SHOW INDEX FROM booking_passengers');
      assert(indexes.some(index => index.Key_name === 'uq_passenger_boarding_token' && index.Non_unique === 0), `${name}: passenger boarding tokens must be unique`);
      console.log(`${index ? 'Legacy upgrade' : 'Fresh schema'} passed, including repeated migration execution.`);
    }
  } finally {
    for (const name of names) {
      if (!/^skywings_test_(schema|upgrade)_\d+$/.test(name)) throw new Error('Unsafe cleanup target');
      await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
    }
    await connection.end();
    await require('../backend/config/database').pool.end();
  }
}
checkSchema().catch(error => { console.error(error.message); process.exitCode = 1; });
