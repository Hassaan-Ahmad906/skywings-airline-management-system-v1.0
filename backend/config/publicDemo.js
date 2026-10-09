const databaseName = 'skywings_public_demo';
const { accounts } = require('./demoSeed');
function validateEnvironment(env=process.env) {
  if(env.PUBLIC_DEMO!=='true'||env.DB_NAME!==databaseName) throw new Error('Public demo requires PUBLIC_DEMO=true and the isolated skywings_public_demo database');
  if(!env.JWT_SECRET||env.JWT_SECRET.length<32) throw new Error('Public demo requires its own random JWT secret');
  if(env.NODE_ENV!=='development'||env.PAYMENT_MODE!=='demo'||env.NOTIFICATIONS_ENABLED!=='false'||env.DISRUPTION_NOTIFICATION_WEBHOOK_URL||env.N8N_BOOKING_EMAIL_WEBHOOK_URL) throw new Error('Public demo requires simulated payments and disabled external notifications');
}
module.exports={databaseName,accounts,validateEnvironment};
