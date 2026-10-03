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
      }
      await setup({ database: name });
      await setup({ database: name });
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
