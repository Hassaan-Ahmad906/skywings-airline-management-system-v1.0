const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let stage = 'no-history';
const versions = fs.readdirSync(path.join(__dirname, '../database/migrations')).filter(file => file.endsWith('.js'));
const pool = {
  getConnection: async () => ({ release() {} }),
  query: async sql => {
    if (sql.includes('information_schema.TABLES')) return [stage === 'no-history' ? [] : [{ TABLE_NAME: 'schema_migrations' }]];
    if (sql.includes('SELECT version')) return [stage === 'pending' ? [] : versions.map(version => ({ version }))];
    if (sql.includes('information_schema.COLUMNS')) return [stage === 'missing-column' ? [] : [{ COLUMN_NAME: 'reservation_expires_at' }]];
    assert.fail(`Unexpected database query: ${sql}`);
  }
};
const id = require.resolve('../backend/config/database');
require.cache[id] = { id, filename: id, loaded: true, exports: { pool } };

test('server refuses an unready database before listening or starting cleanup, and accepts a migrated schema', async () => {
  const app = require('../backend/server');
  const cleaner = require('../backend/services/seatHoldCleaner');
  const originalListen = app.listen;
  app.listen = () => assert.fail('An unready database must never listen');
  try {
    for (stage of ['no-history', 'pending', 'missing-column']) {
      await assert.rejects(app.startServer(0), error => error.code === 'DATABASE_MIGRATION_REQUIRED' && error.message.includes('npm run db:setup'));
      assert.equal(cleaner.intervalId, null);
    }
  } finally { app.listen = originalListen; }
  stage = 'ready';
  const server = await app.startServer(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
