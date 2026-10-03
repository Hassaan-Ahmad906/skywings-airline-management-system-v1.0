const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2');
const crypto = require('node:crypto');
const { openConnection, databaseName } = require('./databaseSetup');
function rowDigest(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]]))).map(row => JSON.stringify(row)).sort())).digest('hex');
}
async function backupDatabase(name = databaseName()) {
  databaseName(name);
  const connection = await openConnection();
  try {
    const [databases] = await connection.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [name]);
    if (!databases.length) return null;
    await connection.query(`USE \`${name}\``);
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const manifest = { database: name, createdAt: new Date().toISOString(), tables: {} };
    const lines = [`-- Snapshot backup ${manifest.createdAt}`, `CREATE DATABASE IF NOT EXISTS \`${name}\`;`, `USE \`${name}\`;`, 'SET FOREIGN_KEY_CHECKS=0;'];
    const [tables] = await connection.query('SHOW TABLES');
    for (const entry of tables) {
      const table = Object.values(entry)[0]; if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error('Unsafe table name');
      const [definition] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      lines.push(definition[0]['Create Table'] + ';');
      const [columns] = await connection.query(`SHOW COLUMNS FROM \`${table}\``);
      const fields = columns.filter(column => !/(VIRTUAL|STORED) GENERATED/.test(column.Extra)).map(column => column.Field);
      const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
      manifest.tables[table] = { count: rows.length, digest: rowDigest(rows) };
      for (let offset = 0; offset < rows.length; offset += 200) {
        const batch = rows.slice(offset, offset + 200).map(row => '(' + fields.map(field => { const value = row[field]; return mysql.escape(value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value) ? JSON.stringify(value) : value); }).join(',') + ')');
        lines.push(`INSERT INTO \`${table}\` (${fields.map(field => `\`${field}\``).join(',')}) VALUES ${batch.join(',')};`);
      }
    }
    await connection.commit();
    lines.push('SET FOREIGN_KEY_CHECKS=1;');
    const directory = path.join(__dirname, '../backups'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
    const sql = lines.join('\n') + '\n';
    manifest.sha256 = crypto.createHash('sha256').update(sql).digest('hex');
    fs.writeFileSync(file, sql, { mode: 0o600 });
    fs.writeFileSync(file + '.manifest.json', JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    return file;
  } finally { await connection.end(); }
}
module.exports = backupDatabase;
module.exports.rowDigest = rowDigest;
if (require.main === module) {
  (async () => {
    const name = databaseName(), file = await backupDatabase(name);
    if (!file) throw new Error('Configured database does not exist');
    await require('./verify_backup')(file,name);
    console.log('Restore-verified private backup: ' + file);
  })().catch(error => { console.error(error.code ? `Backup failed (${error.code})` : error.message); process.exitCode=1; }).finally(() => require('../backend/config/database').pool.end());
}
