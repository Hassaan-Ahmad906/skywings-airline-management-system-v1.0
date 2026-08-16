const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../config/database');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

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
    .optional()
    .trim()
    .matches(/^[\d\s\-\+\(\)]+$/).withMessage('Invalid phone number format')
    .isLength({ max: 20 }).withMessage('Phone number is too long'),
  body('dob')
    .optional()
    .isISO8601().withMessage('Invalid date format')
    .custom((value) => {
      const dob = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - dob.getFullYear();
      if (age < 0 || age > 120) {
        throw new Error('Invalid date of birth');
      }
      return true;
    }),
  body('address')
    .optional()
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
      `SELECT user_id, first_name, last_name, email, password, role, status, phone, date_of_birth, address
       FROM users WHERE email = ?`,
      [email]
    );

    const auditService = require('../services/auditService');

    if (!user) {
      await auditService.logEvent({
        userId: null,
        action: auditService.ACTIONS.AUTH_LOGIN_FAILURE,
        resourceType: 'USER',
        resourceId: null,
        newValue: { email },
        req,
        status: 'FAILURE'
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      await auditService.logEvent({
        userId: user.user_id,
        action: auditService.ACTIONS.AUTH_LOGIN_FAILURE,
        resourceType: 'USER',
        resourceId: user.user_id,
        oldValue: { status: user.status },
        newValue: { email },
        req,
        status: 'FAILURE'
      });
      return res.status(403).json({
        success: false,
        message: 'Account is inactive. Please contact support.'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      await auditService.logEvent({
        userId: user.user_id,
        action: auditService.ACTIONS.AUTH_LOGIN_FAILURE,
        resourceType: 'USER',
        resourceId: user.user_id,
        newValue: { email },
        req,
        status: 'FAILURE'
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate token
    const token = generateToken(user.user_id, user.email, user.role);

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
router.post('/logout', (req, res) => {
  // Clear server cookie with the same path as it was set on
  res.clearCookie('authToken', { path: '/' });
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;
