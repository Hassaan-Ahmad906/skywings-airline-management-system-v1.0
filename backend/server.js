const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

// Load environment configuration from root .env or local .env
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

// Initialize database connection
const db = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;
const localOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...localOrigins, ...configuredOrigins]);

const auditMiddleware = require('./middleware/auditMiddleware');

app.disable('x-powered-by');

// Security headers that do not require unsafe inline-script exceptions.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// Middleware
app.use(auditMiddleware);
app.use(require('./middleware/safeErrors'));
app.use(cors((req, optionsCallback) => {
  optionsCallback(null, {
  origin(origin, callback) {
    const sameOrigin = `${req.protocol}://${req.get('host')}`;
    if (!origin || origin === sameOrigin || allowedOrigins.has(origin)) return callback(null, true);
    const error = new Error('CORS origin is not allowed');
    error.status = 403;
    return callback(error);
  },
  credentials: true
  });
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
// parse cookies for server-side session handling
app.use(cookieParser());
const rateLimit = require('./middleware/rateLimit');
app.use('/api/auth/login', rateLimit());
app.use('/api/auth/register', rateLimit({ limit: 10 }));
app.use('/api/contact', (req, res, next) => req.method === 'POST' ? contactLimit(req, res, next) : next());
const contactLimit = rateLimit({ limit: 10, windowMs: 3600000 });
app.use('/api/seat-holds', rateLimit({ limit: 120, windowMs: 300000 }));

// Static frontend path
const frontendPath = path.join(__dirname, '../frontend');

// Serve static files from frontend/ with no-cache headers for HTML pages so browser history is aligned with session state
app.use(express.static(frontendPath, {
  setHeaders: (res, filePath) => {
    if (path.extname(filePath) === '.html') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const seatHoldCleaner = require('./services/seatHoldCleaner');

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/flights', require('./routes/flights'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/checkin', require('./routes/checkin'));
app.use('/api/boarding', require('./routes/boarding'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/seat-holds', require('./routes/seatHolds'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/itineraries', require('./routes/itineraries'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SkyWings API is running', demo: require('./services/paymentService').demoEnabled() });
});

// Serve HTML files from frontend
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.sendFile(path.join(frontendPath, req.path === '/' ? 'index.html' : req.path));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.status && err.status < 500 ? err.message : 'Internal server error'
  });
});

async function startServer(port = PORT) {
  const connection = await db.pool.getConnection();
  connection.release();
  await require('./services/productionGuard').verify(db.pool);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      if (process.env.NODE_ENV !== 'test') seatHoldCleaner.start(60000);
      console.log('SkyWings server running on port ' + server.address().port);
      resolve(server);
    });
    server.once('error', reject);
  });
}
if (require.main === module) startServer().catch(async error => {
  console.error('Server startup failed:', error.code || error.message);
  seatHoldCleaner.stop();
  await db.pool.end();
  process.exitCode = 1;
});
module.exports = app;
module.exports.startServer = startServer;
