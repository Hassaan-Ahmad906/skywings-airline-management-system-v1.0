const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

// ========== GET USER PROFILE ==========
router.get('/profile', async (req, res) => {
  try {
    const user = await queryOne(
      `SELECT user_id, first_name, last_name, email, phone, date_of_birth, address, role, status, created_at
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
          phone: user.phone,
          dateOfBirth: user.date_of_birth,
          address: user.address,
          role: user.role,
          status: user.status,
          createdAt: user.created_at
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile: ' + error.message
    });
  }
});

// ========== UPDATE USER PROFILE ==========
router.put('/profile', [
  body('firstName')
    .optional()
    .trim()
    .notEmpty().withMessage('First name cannot be empty')
    .isLength({ min: 2, max: 100 }).withMessage('First name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('First name can only contain letters, spaces, hyphens, and apostrophes'),
  body('lastName')
    .optional()
    .trim()
    .notEmpty().withMessage('Last name cannot be empty')
    .isLength({ min: 2, max: 100 }).withMessage('Last name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes'),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email is too long'),
  body('phone')
    .optional()
    .trim()
    .matches(/^[\d\s\-\+\(\)]+$/).withMessage('Invalid phone number format')
    .isLength({ max: 20 }).withMessage('Phone number is too long'),
  body('dateOfBirth')
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

    const { firstName, lastName, email, phone, dateOfBirth, address } = req.body;

    // Check if email is being changed and if it's already taken
    if (email) {
      const existingUser = await queryOne(
        'SELECT user_id FROM users WHERE email = ? AND user_id != ?',
        [email, req.user.userId]
      );

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Email already in use'
        });
      }
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (firstName) {
      updates.push('first_name = ?');
      params.push(firstName);
    }
    if (lastName) {
      updates.push('last_name = ?');
      params.push(lastName);
    }
    if (email) {
      updates.push('email = ?');
      params.push(email);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone || null);
    }
    if (dateOfBirth !== undefined) {
      updates.push('date_of_birth = ?');
      params.push(dateOfBirth || null);
    }
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(address || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    params.push(req.user.userId);

    await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
      params
    );

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile: ' + error.message
    });
  }
});

// ========== CHANGE PASSWORD ==========
router.put('/password', [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error('Passwords do not match');
    }
    return true;
  })
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

    const { currentPassword, newPassword } = req.body;

    // Get current user password
    const user = await queryOne(
      'SELECT password FROM users WHERE user_id = ?',
      [req.user.userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await query(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [hashedPassword, req.user.userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password: ' + error.message
    });
  }
});

// ========== GET SAVED PASSENGERS ==========
router.get('/passengers', async (req, res) => {
  try {
    const passengers = await query(
      `SELECT 
        passenger_id,
        first_name,
        last_name,
        date_of_birth,
        passport_number,
        nationality,
        is_saved,
        created_at
       FROM passengers 
       WHERE user_id = ? AND is_saved = 1
       ORDER BY created_at DESC`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: { passengers: passengers || [] }
    });
  } catch (error) {
    console.error('Get passengers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get passengers: ' + error.message
    });
  }
});

// ========== ADD SAVED PASSENGER ==========
router.post('/passengers', [
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
  body('dateOfBirth')
    .optional()
    .isISO8601().withMessage('Invalid date format')
    .custom((value) => {
      if (value) {
        const dob = new Date(value);
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear();
        if (age < 0 || age > 120) {
          throw new Error('Invalid date of birth');
        }
      }
      return true;
    }),
  body('passportNumber')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('Passport number is too long'),
  body('nationality')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Nationality is too long')
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

    const { firstName, lastName, dateOfBirth, passportNumber, nationality } = req.body;

    const [result] = await require('../config/database').pool.execute(
      `INSERT INTO passengers (user_id, first_name, last_name, date_of_birth, passport_number, nationality, is_saved)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [req.user.userId, firstName, lastName, dateOfBirth || null, passportNumber || null, nationality || null]
    );

    res.status(201).json({
      success: true,
      message: 'Passenger added successfully',
      data: { passenger_id: result.insertId }
    });
  } catch (error) {
    console.error('Add passenger error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add passenger: ' + error.message
    });
  }
});

// ========== DELETE SAVED PASSENGER ==========
router.delete('/passengers/:id', async (req, res) => {
  try {
    const passengerId = req.params.id;
    await query(
      'UPDATE passengers SET is_saved = 0 WHERE passenger_id = ? AND user_id = ?',
      [passengerId, req.user.userId]
    );

    res.json({
      success: true,
      message: 'Passenger removed from saved list'
    });
  } catch (error) {
    console.error('Delete passenger error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete passenger: ' + error.message
    });
  }
});

// ========== GET USER PREFERENCES ==========
router.get('/preferences', async (req, res) => {
  try {
    const pref = await queryOne(
      'SELECT preferred_seat, meal_preference, newsletter_subscription FROM user_preferences WHERE user_id = ?',
      [req.user.userId]
    );

    res.json({
      success: true,
      data: {
        preferredSeat: pref ? pref.preferred_seat : 'window',
        mealPreference: pref ? pref.meal_preference : 'non-vegetarian',
        newsletter: pref ? Boolean(pref.newsletter_subscription) : false
      }
    });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve preferences: ' + error.message
    });
  }
});

// ========== UPDATE USER PREFERENCES ==========
router.put('/preferences', async (req, res) => {
  try {
    const { preferredSeat, mealPreference, newsletter } = req.body;
    const seatVal = ['window', 'aisle', 'middle', 'none'].includes(preferredSeat) ? preferredSeat : 'none';
    const mealVal = ['vegetarian', 'non-vegetarian', 'vegan', 'halal', 'none'].includes(mealPreference) ? mealPreference : 'none';
    const newsVal = newsletter ? 1 : 0;

    await query(
      `INSERT INTO user_preferences (user_id, preferred_seat, meal_preference, newsletter_subscription)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         preferred_seat = VALUES(preferred_seat),
         meal_preference = VALUES(meal_preference),
         newsletter_subscription = VALUES(newsletter_subscription),
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.userId, seatVal, mealVal, newsVal]
    );

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      data: {
        preferredSeat: seatVal,
        mealPreference: mealVal,
        newsletter: Boolean(newsVal)
      }
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences: ' + error.message
    });
  }
});

module.exports = router;
