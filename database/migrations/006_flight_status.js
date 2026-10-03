module.exports = async connection => {
  await connection.query("ALTER TABLE flights MODIFY status ENUM('scheduled','delayed','cancelled','completed','boarding','in_air') DEFAULT 'scheduled'");
};
