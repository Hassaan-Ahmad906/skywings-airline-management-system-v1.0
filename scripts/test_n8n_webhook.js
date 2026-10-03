// Notification verification uses stubbed delivery and never changes real bookings.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', path.join(__dirname, '../tests/notification-safety.test.js')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
