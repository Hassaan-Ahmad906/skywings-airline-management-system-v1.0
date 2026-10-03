require('./public_demo_env')();
const {databaseName}=require('../backend/config/publicDemo');
const db=require('../backend/config/database');
async function resetPublicDemo(){
  if(process.argv.slice(2).join(' ')!=='--reset'||db.pool.pool.config.connectionConfig.database!==databaseName) throw new Error('Reset requires --reset and the isolated skywings_public_demo database');
  const file=await require('./backup_database')(databaseName);
  if(file)await require('./verify_backup')(file,databaseName);
  const connection=await require('./databaseSetup').openConnection();
  try{await connection.query('DROP DATABASE IF EXISTS `skywings_public_demo`');}finally{await connection.end();}
  // Backup and DDL used independent connections; no pooled queries ran yet.
  await require('./setup_public_demo')();
  console.log('Only the isolated public demo database was reset.');
}
resetPublicDemo().catch(error=>{console.error(error.code?`Public demo reset failed (${error.code})`:error.message);process.exitCode=1;}).finally(()=>db.pool.end());
