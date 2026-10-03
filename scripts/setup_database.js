const setupDatabase = require('./databaseSetup');
if (require.main === module) setupDatabase().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
module.exports = setupDatabase;
