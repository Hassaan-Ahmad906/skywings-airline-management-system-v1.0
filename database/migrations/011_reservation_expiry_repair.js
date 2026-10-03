module.exports = async connection => {
  const [columns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reservation_expires_at'");
  if (!columns.length) await connection.query('ALTER TABLE bookings ADD COLUMN reservation_expires_at DATETIME NULL');
  // Preserve existing deadlines; give legacy unpaid reservations the same grace period as migration 003.
  await connection.query("UPDATE bookings SET reservation_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE status = 'PENDING' AND reservation_expires_at IS NULL");
};
