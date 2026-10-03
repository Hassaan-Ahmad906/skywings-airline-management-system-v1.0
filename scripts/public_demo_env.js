const path=require('node:path');
const fs=require('node:fs');
const dotenv=require('dotenv');
function loadPublicDemoEnvironment() {
  dotenv.config({path:path.join(__dirname,'../.env.public-demo')});
  process.env.NODE_ENV='development';
  process.env.PAYMENT_MODE='demo';
  process.env.DB_TIMEZONE='Z';
  process.env.NOTIFICATIONS_ENABLED='false';
  process.env.DISRUPTION_NOTIFICATION_WEBHOOK_URL='';
  process.env.N8N_BOOKING_EMAIL_WEBHOOK_URL='';
  if(process.env.RENDER_EXTERNAL_URL) process.env.FRONTEND_URL=process.env.RENDER_EXTERNAL_URL;
  require('../backend/config/publicDemo').validateEnvironment();
  const primary=path.join(__dirname,'../.env');
  if(fs.existsSync(primary)&&dotenv.parse(fs.readFileSync(primary)).JWT_SECRET===process.env.JWT_SECRET) throw new Error('Public demo must use a JWT secret different from the primary installation');
}
module.exports=loadPublicDemoEnvironment;
