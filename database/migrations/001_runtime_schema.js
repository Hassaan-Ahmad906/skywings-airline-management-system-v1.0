const fs = require('fs');
const path = require('path');
const renames = {
  tickets: { issued_at: 'issue_timestamp' },
  ticket_audit_logs: { audit_id: 'log_id', created_at: 'changed_at' },
  booking_rebooking_history: { rebook_id: 'rebooking_id', previous_flight_id: 'old_flight_id', rebooked_by: 'actor_user_id', rebook_reason: 'rebooking_reason' },
  flight_disruptions: { scheduled_departure_original: 'old_departure_datetime', scheduled_arrival_original: 'old_arrival_datetime', new_departure: 'new_departure_datetime', new_arrival: 'new_arrival_datetime', created_by: 'created_by_user_id' }
};
module.exports = async function migrate(connection) {
  const source = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
  for (const [statement, table, body] of source.matchAll(/CREATE TABLE IF NOT EXISTS `(\w+)` \(([\s\S]*?)\) ENGINE[^;]+;/g)) {
    const [rows] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
    if (!rows.length) { await connection.query(statement); continue; }
    const columns = new Set(rows.map(row => row.COLUMN_NAME));
    for (const [oldName, newName] of Object.entries(renames[table] || {})) {
      if (columns.has(oldName) && !columns.has(newName)) {
        await connection.query(`ALTER TABLE \`${table}\` RENAME COLUMN \`${oldName}\` TO \`${newName}\``);
        columns.delete(oldName); columns.add(newName);
      }
    }
    for (const line of body.split('\n')) {
      const column = line.match(/^\s+`(\w+)`\s+(.+?)(?:,)?$/);
      // Its expression depends on status; add it only after upgrading the status enum.
      if (table === 'seat_holds' && column?.[1] === 'active_flag') continue;
      if (column && !columns.has(column[1])) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ${line.trim().replace(/,$/, '')}`);
    }
  }
  await connection.query("ALTER TABLE bookings MODIFY status ENUM('PENDING','CONFIRMED','CHECKED_IN','BOARDED','COMPLETED','CANCELLED','EXPIRED','MISSED') NOT NULL DEFAULT 'PENDING'");
  const [holdColumns] = await connection.query('SHOW COLUMNS FROM seat_holds');
  const statusType = holdColumns.find(column => column.Field === 'status').Type;
  if (statusType.startsWith('enum(') && !/^enum\('[A-Za-z_]+'(?:,'[A-Za-z_]+')*\)$/.test(statusType)) throw new Error('Unexpected seat-hold enum labels; review the existing status definition before upgrading');
  const requiredStatuses = ['HELD', 'RELEASED', 'EXPIRED', 'CONSUMED'];
  const enumValues = statusType.startsWith('enum(') ? [...statusType.matchAll(/'([A-Za-z_]+)'/g)].map(match => match[1]) : null;
  const missingStatuses = requiredStatuses.filter(status => !enumValues?.includes(status));
  let activeFlag = holdColumns.find(column => column.Field === 'active_flag');
  if (missingStatuses.length) {
    // TiDB rejects modifying a column referenced by a generated column, even for enum changes.
    if (activeFlag) {
      if (!activeFlag.Extra.includes('GENERATED')) throw new Error('seat_holds.active_flag must be generated; refusing to remove a data column');
      const [dependentIndexes] = await connection.query("SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'seat_holds' AND COLUMN_NAME = 'active_flag'");
      if (dependentIndexes.some(index => index.INDEX_NAME !== 'uq_flight_seat_active')) throw new Error('Custom indexes depend on seat_holds.active_flag; review them before upgrading');
      if (dependentIndexes.length) await connection.query('ALTER TABLE seat_holds DROP INDEX uq_flight_seat_active');
      await connection.query('ALTER TABLE seat_holds DROP COLUMN active_flag');
      activeFlag = null;
    }
    // Append missing enum values without removing/reordering existing ordinals.
    // Retain the legacy CONFIRMED label in the enum, but convert its rows to CONSUMED below.
    const statuses = enumValues ? [...enumValues, ...missingStatuses] : [...requiredStatuses, 'CONFIRMED'];
    await connection.query(`ALTER TABLE seat_holds MODIFY status ENUM(${statuses.map(status => `'${status}'`).join(',')}) NOT NULL DEFAULT 'HELD'`);
  }
  await connection.query("UPDATE seat_holds SET status = 'CONSUMED' WHERE status = 'CONFIRMED'");
  await connection.query("ALTER TABLE flight_disruptions MODIFY status VARCHAR(32) NOT NULL DEFAULT 'PENDING_EXECUTION'");
  await connection.query("UPDATE flight_disruptions SET status = CASE WHEN status = 'PENDING' THEN 'PENDING_EXECUTION' WHEN status IN ('NOTIFIED','RESOLVED') THEN 'EXECUTED' ELSE status END");
  const [oldUnique] = await connection.query("SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'idempotency_key' AND NON_UNIQUE = 0");
  for (const index of oldUnique) {
    const [parts] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND INDEX_NAME = ?", [index.INDEX_NAME]);
    if (parts[0].count === 1) await connection.query(`ALTER TABLE bookings DROP INDEX \`${index.INDEX_NAME}\``);
  }
  await connection.query("UPDATE seat_holds SET status = 'EXPIRED' WHERE status = 'HELD' AND expires_at <= NOW()");
  await connection.query("UPDATE seat_holds h JOIN seat_holds newer ON h.flight_id = newer.flight_id AND h.seat_number = newer.seat_number AND h.hold_id < newer.hold_id AND newer.status = 'HELD' SET h.status = 'RELEASED' WHERE h.status = 'HELD'");
  if (!activeFlag) await connection.query("ALTER TABLE seat_holds ADD COLUMN active_flag TINYINT GENERATED ALWAYS AS (IF(status = 'HELD', 1, NULL)) VIRTUAL");
  for (const [table, name, columns] of [
    ['bookings', 'uq_user_idempotency', '`user_id`, `idempotency_key`'],
    ['seat_holds', 'uq_flight_seat_active', '`flight_id`, `seat_number`, `active_flag`'],
    ['check_ins', 'uq_boarding_token', '`boarding_token`'],
    ['disruption_affected_passengers', 'uq_disruption_passenger', '`disruption_id`, `passenger_id`']
  ]) {
    const [existing] = await connection.query('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, name]);
    if (!existing.length) await connection.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${name}\` (${columns})`);
  }
};
