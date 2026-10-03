const setup = require('./databaseSetup');
const backup = require('./backup_database');
const { pool } = require('../backend/config/database');
async function resetDatabase() {
  const name = setup.databaseName();
  const host = pool.pool.config.connectionConfig.host;
  if (name !== 'skywings_airlines' || !['localhost','127.0.0.1','::1'].includes(host) || process.env.NODE_ENV === 'production') throw new Error('Reset is limited to the local development skywings_airlines database');
  const file = await backup(name);
  if (file) {
    console.log('Backup saved: ' + file);
    await require('./verify_backup')(file, name);
  }
  const connection = await setup.openConnection();
  try { await connection.query('DROP DATABASE IF EXISTS '+String.fromCharCode(96)+name+String.fromCharCode(96)); }
  finally { await connection.end(); }
  await setup({ database: name });
  await require('./seed_database')();
}
if (require.main === module) resetDatabase().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = resetDatabase;
