const sql = `CREATE TABLE IF NOT EXISTS contact_messages (
  message_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  category VARCHAR(40) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new','reviewed') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
module.exports = async connection => { await connection.query(sql); };
module.exports.sql = sql;
