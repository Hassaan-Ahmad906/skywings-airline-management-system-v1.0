require('./public_demo_env')();
const {databaseName}=require('../backend/config/publicDemo');
const db=require('../backend/config/database');
async function setupPublicDemo() {
  if(db.pool.pool.config.connectionConfig.database!==databaseName) throw new Error('Refusing to seed a database outside the public demo');
  await require('./databaseSetup')({database:databaseName});
  const result=await require('./seed_database')({publicDemo:true});
  const [[marker]]=await db.pool.execute("SELECT version FROM schema_migrations WHERE version='public_demo_seed_complete_v1'");
  if(result.skipped&&!marker) throw new Error('The isolated public demo seed is incomplete. Run db:reset:public-demo -- --reset to rebuild only this demo database.');
  if(!result.skipped) await db.pool.execute("INSERT INTO schema_migrations (version) VALUES ('public_demo_seed_complete_v1')");
  return result;
}
if(require.main===module) setupPublicDemo().catch(error=>{console.error(error.code?`Public demo setup failed (${error.code})`:error.message);process.exitCode=1;}).finally(()=>db.pool.end());
module.exports=setupPublicDemo;
