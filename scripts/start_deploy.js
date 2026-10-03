require('dotenv').config();

async function startDeployment() {
  await require('./databaseSetup')();
  return require('../backend/server').startServer();
}

if (require.main === module) startDeployment().catch(async error => {
  console.error('Deployment startup failed:', error.code ? `${error.code}: ${error.message}` : error.message);
  require('../backend/services/seatHoldCleaner').stop();
  await require('../backend/config/database').pool.end();
  process.exitCode = 1;
});

module.exports = { startDeployment };
