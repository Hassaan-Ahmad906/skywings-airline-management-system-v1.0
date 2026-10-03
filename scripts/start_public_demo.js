require('./public_demo_env')();
async function startPublicDemo(port) {
  await require('./setup_public_demo')();
  return require('../backend/server').startServer(port);
}
if(require.main===module) startPublicDemo().catch(async error=>{
  console.error(error.code?`Public demo startup failed (${error.code})`:error.message);
  require('../backend/services/seatHoldCleaner').stop();
  await require('../backend/config/database').pool.end();
  process.exitCode=1;
});
module.exports=startPublicDemo;
