module.exports = async connection => {
  await connection.query("ALTER TABLE contact_messages MODIFY status ENUM('new','reviewed','resolved') NOT NULL DEFAULT 'new'");
  const [columns] = await connection.query('SHOW COLUMNS FROM contact_messages');
  if (!columns.some(column => column.Field === 'deleted_at')) await connection.query('ALTER TABLE contact_messages ADD deleted_at DATETIME NULL');
};
