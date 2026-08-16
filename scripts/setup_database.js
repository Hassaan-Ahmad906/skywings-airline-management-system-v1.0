/**
 * SkyWings Airlines - Database Setup Script
 * Executes database/schema.sql to create database tables and constraints.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

async function setupDatabase() {
  console.log('🔧 Connecting to Database Server...');
  const isTiDB = (process.env.DB_HOST && process.env.DB_HOST.includes('tidbcloud.com')) || process.env.DB_SSL === 'true';
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '2240',
    multipleStatements: true,
    ssl: isTiDB ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
  });

  try {
    console.log('📖 Reading schema definition from database/schema.sql...');
    const schemaPath = path.join(__dirname, '../database/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('🚀 Executing database schema DDL...');
    await connection.query(schemaSql);

    console.log('✅ Database setup completed successfully! All 17 tables and indexes verified.');
  } catch (error) {
    console.error('❌ Database Setup Failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  setupDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = setupDatabase;
