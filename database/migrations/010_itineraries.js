module.exports = async connection => {
  await connection.query(`CREATE TABLE IF NOT EXISTS itineraries (
    itinerary_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, itinerary_reference VARCHAR(30) NOT NULL UNIQUE,
    user_id INT NOT NULL, trip_type ENUM('oneway','return','multicity') NOT NULL, class VARCHAR(20) NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL, idempotency_key VARCHAR(100) NOT NULL, request_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_itinerary_user_key (user_id,idempotency_key),
    CONSTRAINT itinerary_user FOREIGN KEY (user_id) REFERENCES users(user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [columns] = await connection.query('SHOW COLUMNS FROM bookings');
  for (const [name,type] of [['itinerary_id','INT NULL'],['segment_index','INT NULL']]) {
    if (!columns.some(column => column.Field === name)) await connection.query(`ALTER TABLE bookings ADD ${name} ${type}`);
  }
  const [indexes] = await connection.query('SHOW INDEX FROM bookings');
  if (!indexes.some(index => index.Key_name === 'uq_itinerary_segment')) await connection.query('ALTER TABLE bookings ADD UNIQUE KEY uq_itinerary_segment (itinerary_id, segment_index)');
};
