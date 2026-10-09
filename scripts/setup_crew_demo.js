const db = require('../backend/config/database');
const { accounts } = require('../backend/config/demoSeed');
(async () => {
  const host = db.pool.pool.config.connectionConfig.host;
  if (process.env.NODE_ENV === 'production' || process.env.PAYMENT_MODE !== 'demo' || process.env.DB_NAME !== 'skywings_airlines' || !['localhost','127.0.0.1','::1'].includes(host)) throw new Error('Crew demo account is limited to the local demo database');
  const [[user]] = await db.pool.execute('SELECT user_id FROM users WHERE email = ?', [accounts.crew.email]);
  if (!user) {
    const hash = await require('bcryptjs').hash(accounts.crew.password, 12);
    await db.pool.execute("INSERT INTO users (first_name,last_name,email,password,role,gate_airport_code) VALUES ('Hamza','Iqbal',?,?,'crew','KHI')", [accounts.crew.email,hash]);
  }
  console.log('Local Karachi crew demo account is available. Existing customer data preserved.');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.pool.end());
