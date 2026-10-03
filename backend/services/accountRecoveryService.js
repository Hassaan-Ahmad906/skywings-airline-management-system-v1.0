const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const audit = require('./auditService');

async function normalizeEmail(email) {
  const req = { body: { email } };
  await body('email').isString().bail().trim().isEmail().bail().normalizeEmail().isLength({ max: 255 }).run(req);
  if (!validationResult(req).isEmpty()) throw new Error('Provide a valid account email');
  return req.body.email;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) throw new Error('Use a password of at least 12 characters, no more than 72 UTF-8 bytes, with uppercase, lowercase and a number');
  if (password === 'DemoPass123!') throw new Error('Choose a unique password rather than the published sample password');
}

async function inspect(pool, email) {
  email = await normalizeEmail(email);
  const [rows] = await pool.execute('SELECT user_id,email,role,status,password FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user) return { email, exists: false };
  return { userId: user.user_id, email: user.email, exists: true, role: user.role, status: user.status,
    passwordFormat: /^\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}$/.test(user.password || '') ? 'bcrypt' : 'unsupported' };
}

// Operator-only recovery through a protected database connection; this is not an HTTP endpoint.
async function reset(pool, email, password) {
  email = await normalizeEmail(email);
  validatePassword(password);
  if (process.env.NODE_ENV === 'production' && email.endsWith('.test')) throw new Error('Synthetic accounts cannot be recovered for production use');
  const hash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT user_id,email,role,status,token_version FROM users WHERE email = ? FOR UPDATE', [email]);
    const user = rows[0];
    if (!user) throw new Error('Account not found in the configured database; no account was created');
    if (user.status !== 'active') throw new Error('Account is inactive or suspended; recovery does not reactivate it');
    await connection.execute('UPDATE users SET password = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [hash, user.user_id]);
    await audit.logEvent({ action: audit.ACTIONS.PASSWORD_RESET, resourceType: 'USER', resourceId: user.user_id,
      metadata: { source: 'database_operator_cli', sessions_revoked: true }, connection });
    await connection.commit();
    return { email: user.email, role: user.role };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

module.exports = { inspect, reset };
