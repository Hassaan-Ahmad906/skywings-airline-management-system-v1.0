module.exports = async connection => {
  await connection.query("UPDATE bookings SET reservation_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE status = 'PENDING' AND reservation_expires_at IS NULL");
};
