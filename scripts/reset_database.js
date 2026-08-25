/**
 * SkyWings Airlines - Database Reset & Seed Utility
 * Runs complete table initialization followed by master seeding.
 */
const setupDatabase = require('./setup_database');
const seedDatabase = require('./seed_database');

async function resetDatabase() {
  console.log('====================================================');
  console.log('🔄 SKYWINGS AIRLINES - COMPLETE DATABASE RESET');
  console.log('====================================================');
  
  await setupDatabase();
  console.log('----------------------------------------------------');
  await seedDatabase();
  console.log('====================================================');
  console.log('🎉 Database is fully initialized, seeded, and ready!');
  console.log('====================================================');
}

if (require.main === module) {
  resetDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = resetDatabase;
