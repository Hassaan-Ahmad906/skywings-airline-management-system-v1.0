const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../config/database');
const { generateToken } = require('../middleware/auth');

const router = require('../middleware/asyncRouter')();

async function loginFailure(req, res, user, reason, status = 401) {
  // Always generate the support reference server-side, independently of client headers.
  const reference = randomUUID();
  req.id = reference;
  res.setHeader('X-Request-ID', reference);
  const audit = require('../services/auditService');
  await audit.logEvent({
    userId: user?.user_id || null,
    action: audit.ACTIONS.AUTH_LOGIN_FAILURE,
    resourceType: 'USER',
    resourceId: user?.user_id || null,
    newValue: { email: req.body.email },
    metadata: { reason },
    req,
    status: 'FAILURE'
  });
  // Correlation works in hosted logs even when the audit database is unavailable.
  console.warn('Authentication rejected:', JSON.stringify({ reference, reason }));
  return res.status(status).json({
    success: false,
    message: status === 403 ? 'Account is inactive. Please contact support.' : 'Invalid email or password',
    request_id: reference
  });
}

// ========== REGISTER ==========
router.post('/register', [
  body('firstName')
    .trim()
    .notEmpty().withMessage('First name is required')
    .isLength({ min: 2, max: 100 }).withMessage('First name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),
  body('lastName')
    .trim()
    .notEmpty().withMessage('Last name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Last name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),
  body('email')
    .trim()
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email is too long'),
  body('password')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error('Passwords do not match');
    }
    return true;
  }),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^[\d\s\-\+\(\)]+$/).withMessage('Invalid phone number format')
    .isLength({ max: 20 }).withMessage('Phone number is too long'),
  body('dob')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('Invalid date format')
    .custom((value) => {
      if (!value) return true;
      const dob = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - dob.getFullYear();
      if (age < 0 || age > 120) {
        throw new Error('Invalid date of birth');
      }
      return true;
    }),
  body('address')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 }).withMessage('Address is too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { firstName, lastName, email, password, phone, dob, address } = req.body;

    // Check if email already exists
    const existingUser = await queryOne(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await require('../config/database').pool.execute(
      `INSERT INTO users (first_name, last_name, email, password, phone, date_of_birth, address, role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'active')`,
      [firstName, lastName, email, hashedPassword, phone || null, dob || null, address || null]
    );

    const userId = result.insertId;

    // Generate token
    const token = generateToken(userId, email, 'user');
    // Set httpOnly cookie with token (secure in production)
    res.cookie('authToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        userId,
        email,
        firstName,
        lastName
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed: ' + error.message
    });
  }
});

// ========== LOGIN ==========
router.post('/login', [
  body('email')
    .trim()
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Get user from database
    const user = await queryOne(
      `SELECT user_id, first_name, last_name, email, password, role, status, phone, date_of_birth, address, token_version
       FROM users WHERE email = ?`,
      [email]
    );

    const auditService = require('../services/auditService');

    if (!user) {
      return loginFailure(req, res, null, 'ACCOUNT_NOT_FOUND');
    }

    // Check if user is active
    if (user.status !== 'active') {
      return loginFailure(req, res, user, 'ACCOUNT_INACTIVE', 403);
    }

    if (!/^\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}$/.test(user.password || '')) {
      return loginFailure(req, res, user, 'PASSWORD_STORAGE_INVALID');
    }
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return loginFailure(req, res, user, 'PASSWORD_MISMATCH');
    }

    // Generate token
    const token = generateToken(user.user_id, user.email, user.role, user.token_version);

    // Audit log successful login
    await auditService.logEvent({
      userId: user.user_id,
      action: auditService.ACTIONS.AUTH_LOGIN_SUCCESS,
      resourceType: 'USER',
      resourceId: user.user_id,
      newValue: { email: user.email, role: user.role },
      req,
      status: 'SUCCESS'
    });
    // Set httpOnly cookie with token (secure in production)
    res.cookie('authToken', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          userId: user.user_id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          dateOfBirth: user.date_of_birth,
          address: user.address
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed: ' + error.message
    });
  }
});

// ========== CHECK AUTHENTICATION STATUS ==========
const { authenticate } = require('../middleware/auth');
router.get('/check', authenticate, async (req, res) => {
  try {
    const user = await queryOne(
      `SELECT user_id, first_name, last_name, email, role, status, phone, date_of_birth, address
       FROM users WHERE user_id = ?`,
      [req.user.userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          userId: user.user_id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          dateOfBirth: user.date_of_birth,
          address: user.address
        }
      }
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication check failed: ' + error.message
    });
  }
});

// ========== LOGOUT ==========
router.post('/logout', authenticate, async (req, res) => {
  await query('UPDATE users SET token_version = token_version + 1 WHERE user_id = ?', [req.user.userId]);
  // Clear server cookie with the same path as it was set on
  res.clearCookie('authToken', { path: '/' });
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;
