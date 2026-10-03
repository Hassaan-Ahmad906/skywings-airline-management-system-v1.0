async function verify(pool) {
  if (process.env.NODE_ENV !== 'production') return;
  const [samples] = await pool.execute("SELECT email,password FROM users WHERE status = 'active' AND (email LIKE '%@%.test' OR email IN ('admin@skywings.com','user@skywings.com','crew@skywings.com'))");
  for (const sample of samples) {
    if (sample.email.toLowerCase().endsWith('.test') || await require('bcryptjs').compare('DemoPass123!',sample.password)) {
      throw Object.assign(new Error('Remove or disable synthetic demo accounts and replace default credentials before production startup'), { code:'DEMO_ACCOUNTS_ACTIVE' });
    }
  }
}
module.exports={verify};
