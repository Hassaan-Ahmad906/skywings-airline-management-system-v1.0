// Run independent regressions without touching the application database or external delivery.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const tests = fs.readdirSync(path.join(__dirname, '../tests')).filter(file => file.endsWith('.test.js')).map(file => path.join(__dirname, '../tests', file));
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', NOTIFICATIONS_ENABLED: 'false' } });
process.exitCode = result.status ?? 1;
