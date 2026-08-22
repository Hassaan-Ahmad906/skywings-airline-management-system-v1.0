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

const auditMiddleware = require('./middleware/auditMiddleware');

// Middleware
app.use(auditMiddleware);
app.use(cors({
  origin: true, // Reflects the request origin, allowing requests from Vercel & localhost
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// parse cookies for server-side session handling
app.use(cookieParser());

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'SkyWings API is running' });
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
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server after database connection is verified
db.pool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    connection.release();
    
    // Start background seat hold expiration cleaner
    seatHoldCleaner.start(60000);
    
    // Start HTTP server on the correct port (not MySQL port 3306)
    const server = app.listen(PORT, () => {
      console.log(`🚀 SkyWings Airlines server running on http://localhost:${PORT}`);
      console.log(`📊 API endpoints available at http://localhost:${PORT}/api`);
      console.log(`🌐 Access the application at http://localhost:${PORT}`);
    });
    
    // Handle server errors
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
        console.error(`   Please stop the other process or change PORT in .env file`);
        console.error(`   Note: PORT should be for HTTP server (e.g., 3000), not MySQL port (3306)`);
      } else {
        console.error('❌ Server error:', err.message);
      }
      process.exit(1);
    });
  })
  .catch(err => {
    console.error('❌ Failed to connect to database:', err.message);
    console.error('Please ensure:');
    console.error('  1. MySQL Server is running (not XAMPP MySQL)');
    console.error('  2. Database credentials are correct in .env file');
    console.error('  3. Database "skywings_airlines" exists');
    console.error('\nTo test connection: node scripts/test_mysql_connection.js');
    process.exit(1);
  });

module.exports = app;
