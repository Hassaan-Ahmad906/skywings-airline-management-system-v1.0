const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const bookingStateMachine = require('../services/bookingStateMachine');

const router = express.Router();

// Mount authentication middleware
router.use(authenticate);

/**
 * Gate Boarding Scan API: Transitions booking from CHECKED_IN -> BOARDED
 * and associated tickets from ISSUED -> USED
 */
router.post('/scan', [
  body('booking_id').isInt().withMessage('Valid booking_id is required'),
  body('gate_number').optional().trim().notEmpty().withMessage('Gate number cannot be empty')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { booking_id, gate_number } = req.body;
  const connection = await db.pool.getConnection();

  try {
    await connection.beginTransaction();

    const actor = {
      type: req.user.role === 'admin' ? 'ADMIN' : 'GATE_AGENT',
      userId: req.user.userId,
      role: req.user.role
    };

    const updatedBooking = await bookingStateMachine.transitionBookingState(
      connection,
      booking_id,
      'BOARDED',
      actor,
      `Boarded at gate ${gate_number || 'TBA'}`
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Passenger successfully boarded. Ticket status updated to USED.',
      data: {
        booking: updatedBooking
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Boarding scan error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Boarding process failed',
      error: { code: error.code || 'BOARDING_FAILED' }
    });
  } finally {
    connection.release();
  }
});

module.exports = router;
