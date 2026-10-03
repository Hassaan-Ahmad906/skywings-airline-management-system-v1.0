module.exports = async connection => {
  const [rows] = await connection.query("SHOW COLUMNS FROM seat_holds LIKE 'booking_id'");
  if (!rows.length) await connection.query('ALTER TABLE seat_holds ADD COLUMN booking_id INT NULL');
};
