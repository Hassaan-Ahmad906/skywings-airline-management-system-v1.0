module.exports = async connection => {
  const [rows] = await connection.query("SHOW COLUMNS FROM bookings LIKE 'refund_status'");
  if (!rows.length) await connection.query("ALTER TABLE bookings ADD COLUMN refund_status ENUM('none','pending','completed','failed') NOT NULL DEFAULT 'none'");
};
