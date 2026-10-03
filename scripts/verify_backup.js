const fs = require('node:fs');
const setup = require('./databaseSetup');
module.exports = async function verifyBackup(file, sourceName) {
  const name = `skywings_test_restore_${process.pid}`;
  const connection = await setup.openConnection();
  try {
    const source = fs.readFileSync(file, 'utf8').replace(`CREATE DATABASE IF NOT EXISTS \`${sourceName}\`;`, `CREATE DATABASE IF NOT EXISTS \`${name}\`;`).replace(`USE \`${sourceName}\`;`, `USE \`${name}\`;`);
    await connection.query(source);
    const [tables] = await connection.query(`SHOW TABLES FROM \`${sourceName}\``);
    for (const entry of tables) {
      const table = Object.values(entry)[0];
      if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error('Unsafe backup table');
      const [[original]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${sourceName}\`.\`${table}\``);
      const [[restored]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${name}\`.\`${table}\``);
      if (original.count !== restored.count) throw new Error(`Backup row count mismatch for ${table}`);
    }
    console.log('Backup restored and row counts verified in an isolated database.');
  } finally {
    if (!/^skywings_test_restore_\d+$/.test(name)) throw new Error('Unsafe backup cleanup target');
    await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); await connection.end();
  }
};
