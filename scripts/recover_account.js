const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const db = require('../backend/config/database');
const recovery = require('../backend/services/accountRecoveryService');

async function main() {
  const [mode, email, ...extra] = process.argv.slice(2);
  if (!['--check', '--reset'].includes(mode) || !email || extra.length) throw new Error('Usage: npm run account:recover -- --check EMAIL or --reset EMAIL (passwords are entered privately, never as arguments)');
  await require('../backend/services/schemaReadiness').verify(db.pool);
  const config = db.pool.pool.config.connectionConfig;
  console.log(`Database target: ${config.host}:${config.port}/${config.database}`);
  const account = await recovery.inspect(db.pool, email);
  console.log(JSON.stringify(account, null, 2));
  if (mode === '--check') return;
  if (!account.exists) throw new Error('Account not found; verify the database connection or register a customer account on the intended website');
  if (account.status !== 'active') throw new Error('Recovery does not reactivate inactive or suspended accounts');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Password reset requires an interactive terminal');

  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  const abort = new AbortController();
  reader.on('SIGINT', () => { abort.abort(); reader.close(); });
  async function secret(prompt) {
    process.stdout.write(prompt);
    muted = true;
    try { return await reader.question('', { signal: abort.signal }); }
    finally { muted = false; process.stdout.write('\n'); }
  }
  try {
    const confirmation = await reader.question(`Type RESET ${account.email} to reset this account and revoke its sessions: `, { signal: abort.signal });
    if (confirmation !== `RESET ${account.email}`) throw new Error('Recovery cancelled; no password changed');
    const password = await secret('New password (hidden): ');
    if (password !== await secret('Confirm password (hidden): ')) throw new Error('Passwords do not match; no password changed');
    const result = await recovery.reset(db.pool, email, password);
    console.log(`Password reset for ${result.email}; role preserved (${result.role}) and old sessions revoked. Sign in with the password you entered.`);
  } finally { reader.close(); process.stdin.pause(); }
}

main().catch(error => { console.error('Account recovery:', error.message); process.exitCode = 1; }).finally(() => db.pool.end());
