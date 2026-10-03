const fs = require('node:fs');
const path = require('node:path');

function migrationRequired(details) {
  return Object.assign(new Error(`Database schema is not ready (${details}). Run npm run db:setup against this deployment's database before starting, or use npm run start:deploy.`), { code: 'DATABASE_MIGRATION_REQUIRED' });
}

async function verify(connection) {
  const [tables] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'");
  if (!tables.length) throw migrationRequired('migration history is missing');

  const [applied] = await connection.query('SELECT version FROM schema_migrations');
  const versions = new Set(applied.map(row => row.version));
  const required = fs.readdirSync(path.join(__dirname, '../../database/migrations')).filter(file => file.endsWith('.js')).sort();
  const pending = required.filter(version => !versions.has(version));
  if (pending.length) throw migrationRequired(`pending: ${pending.join(', ')}`);

  // Check the reported production failure even if an old migration was manually marked applied.
  const [columns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'reservation_expires_at'");
  if (!columns.length) throw migrationRequired('bookings.reservation_expires_at is missing');
}

module.exports = { verify };
