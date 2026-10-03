const fs = require('node:fs');
const crypto = require('node:crypto');
const setup = require('./databaseSetup');
const { rowDigest } = require('./backup_database');
module.exports = async function verifyBackup(file, sourceName) {
  const name = `skywings_test_restore_${process.pid}`;
  const connection = await setup.openConnection();
  try {
    setup.databaseName(sourceName);
    const sql = fs.readFileSync(file, 'utf8');
    const manifest = fs.existsSync(file + '.manifest.json') ? JSON.parse(fs.readFileSync(file + '.manifest.json', 'utf8')) : null;
    if (manifest && (manifest.database !== sourceName || manifest.sha256 !== crypto.createHash('sha256').update(sql).digest('hex'))) throw new Error('Backup manifest or checksum mismatch');
    const source = sql.replace(`CREATE DATABASE IF NOT EXISTS \`${sourceName}\`;`, `CREATE DATABASE IF NOT EXISTS \`${name}\`;`).replace(`USE \`${sourceName}\`;`, `USE \`${name}\`;`);
    await connection.query(source);
    const [tables] = await connection.query(`SHOW TABLES FROM \`${name}\``);
    const names = tables.map(entry => Object.values(entry)[0]).sort();
    if (manifest && JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.tables).sort())) throw new Error('Backup table list mismatch');
    for (const table of names) {
      if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error('Unsafe backup table');
      if (manifest) {
        const [rows] = await connection.query(`SELECT * FROM \`${name}\`.\`${table}\``);
        if (rows.length !== manifest.tables[table].count || rowDigest(rows) !== manifest.tables[table].digest) throw new Error(`Backup contents mismatch for ${table}`);
        continue;
      }
      const [[original]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${sourceName}\`.\`${table}\``);
      const [[restored]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${name}\`.\`${table}\``);
      if (original.count !== restored.count) throw new Error(`Backup row count mismatch for ${table}`);
    }
    console.log('Backup restored and contents verified in an isolated database.');
    if (manifest) fs.writeFileSync(file + '.verified.json', JSON.stringify({ sha256: manifest.sha256, verifiedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
  } finally {
    if (!/^skywings_test_restore_\d+$/.test(name)) throw new Error('Unsafe backup cleanup target');
    await connection.query(`DROP DATABASE IF EXISTS \`${name}\``); await connection.end();
  }
};
