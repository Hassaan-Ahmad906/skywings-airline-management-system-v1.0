const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2');
const { openConnection, databaseName } = require('./databaseSetup');
async function backupDatabase(name = databaseName()) {
  const connection = await openConnection();
  try {
    const [databases] = await connection.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [name]);
    if (!databases.length) return null;
    await connection.query(`USE \`${name}\``);
    const lines = [`-- Local backup ${new Date().toISOString()}`, `CREATE DATABASE IF NOT EXISTS \`${name}\`;`, `USE \`${name}\`;`, 'SET FOREIGN_KEY_CHECKS=0;'];
    const [tables] = await connection.query('SHOW TABLES');
    for (const entry of tables) {
      const table = Object.values(entry)[0]; if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error('Unsafe table name');
      const [definition] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      lines.push(definition[0]['Create Table'] + ';');
      const [columns] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
      const fields = columns.filter(column => !/(VIRTUAL|STORED) GENERATED/.test(column.Extra)).map(column => column.Field);
      const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
      for (const row of rows) {
        const values = fields.map(field => { const value = row[field]; return mysql.escape(value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value) ? JSON.stringify(value) : value); });
        lines.push(`INSERT INTO \`${table}\` (${fields.map(field => `\`${field}\``).join(',')}) VALUES (${values.join(',')});`);
      }
    }
    lines.push('SET FOREIGN_KEY_CHECKS=1;');
    const directory = path.join(__dirname, '../backups'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
    fs.writeFileSync(file, lines.join('\n') + '\n'); return file;
  } finally { await connection.end(); }
}
module.exports = backupDatabase;
