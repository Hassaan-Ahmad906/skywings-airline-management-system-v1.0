const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
function databaseName(value = process.env.DB_NAME || 'skywings_airlines') {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('Invalid database name');
  return value;
}
async function openConnection() {
  const { pool } = require('../backend/config/database');
  const config = pool.pool.config.connectionConfig;
  return mysql.createConnection({ host: config.host, port: config.port, user: config.user,
    password: config.password, ssl: config.ssl, multipleStatements: true });
}
async function setupDatabase(options = {}) {
  const name = databaseName(options.database);
  const connection = await openConnection();
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${name}\``);
    await connection.query(fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8'));
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    const directory = path.join(__dirname, '../database/migrations');
    for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort()) {
      const [rows] = await connection.execute('SELECT version FROM schema_migrations WHERE version = ?', [file]);
      if (rows.length) continue;
      console.log(`Applying migration: ${file}`);
      try { await require(path.join(directory, file))(connection); }
      catch (error) { error.message = `Migration ${file} failed: ${error.message}`; throw error; }
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    }
    console.log(`Schema and versioned migrations verified: ${name}`);
  } finally { await connection.end(); }
}
module.exports = setupDatabase;
module.exports.openConnection = openConnection;
module.exports.databaseName = databaseName;
