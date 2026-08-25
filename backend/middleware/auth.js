const jwt = require('jsonwebtoken');
const { queryOne } = require('../config/database');

const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;

if (isProduction && (!JWT_SECRET || JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production.');
}

const signingSecret = JWT_SECRET || 'development-only-secret-do-not-use-in-production';

// Middleware to verify JWT token
async function authenticate(req, res, next) {
  try {
    // Accept token from Authorization header or from an httpOnly cookie named 'authToken'
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.authToken) {
      token = req.cookies.authToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: No token provided'
      });
    }
    
    try {
      const decoded = jwt.verify(token, signingSecret);
      
      // Get user from database to ensure they still exist and are active
      const user = await queryOne(
        'SELECT user_id, email, role, status FROM users WHERE user_id = ? AND status = ?',
        [decoded.userId, 'active']
      );

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized: User not found or inactive'
        });
      }

      req.user = {
        userId: user.user_id,
        email: user.email,
        role: user.role
      };
      
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid or expired token'
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
}

// Middleware to require admin role
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Admin access required'
    });
  }
  next();
}

// Generate JWT token
function generateToken(userId, email, role) {
  return jwt.sign(
    { userId, email, role },
    signingSecret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

module.exports = {
  authenticate,
  requireAdmin,
  generateToken,
  signingSecret
};

