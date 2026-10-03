module.exports = async connection => {
  await connection.query("ALTER TABLE users MODIFY role ENUM('user','admin','crew') DEFAULT 'user'");
  for (const [table, column, definition] of [['users','gate_airport_code','VARCHAR(3) NULL'],['flights','gate_number','VARCHAR(10) NULL'],['flights','boarding_open','TINYINT NOT NULL DEFAULT 0']]) {
    const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
    if (!columns.some(item => item.Field === column)) await connection.query(`ALTER TABLE ${table} ADD ${column} ${definition}`);
  }
  await connection.query(`CREATE TABLE IF NOT EXISTS gate_audit_events (
    event_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    flight_id INT NULL, booking_id INT NULL, passenger_id INT NULL, actor_user_id INT NULL,
    action VARCHAR(40) NOT NULL, outcome ENUM('accepted','rejected') NOT NULL,
    reason VARCHAR(255) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_gate_flight (flight_id, event_id),
    CONSTRAINT gate_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
};
