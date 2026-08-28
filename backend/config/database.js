const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

if (process.env.NODE_ENV === 'production' && (!process.env.DB_PASSWORD || !process.env.DB_USER || !process.env.DB_HOST)) {
  throw new Error('DB_HOST, DB_USER, and DB_PASSWORD must be configured in production.');
}

// Database configuration for MySQL / TiDB Cloud Serverless
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '2240', // Local development only; production is validated above.
  database: process.env.DB_NAME || 'skywings_airlines',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
  multipleStatements: false,
  dateStrings: false,
  ssl: (process.env.DB_SSL === 'true' || (process.env.DB_HOST && process.env.DB_HOST.includes('tidbcloud.com'))) ? {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  } : undefined
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test connection (silent - errors will be caught when pool is actually used)
// This prevents duplicate connection messages in server.js

// Helper function to execute queries
async function query(sql, params = []) {
  try {
    const [results, fields] = await pool.execute(sql, params);
    // For INSERT queries, results is a ResultSetHeader with insertId
    // For SELECT queries, results is an array of rows
    return results;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Helper function to get a single row
async function queryOne(sql, params = []) {
  const results = await query(sql, params);
  return results[0] || null;
}

module.exports = {
  pool,
  query,
  queryOne
};

