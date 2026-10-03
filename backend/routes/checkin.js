const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const seatAllocationService = require('../services/seatAllocationService');

const router = require('../middleware/asyncRouter')();

// All check-in routes require authentication
router.use(authenticate);

// ========== SEARCH BOOKING FOR CHECK-IN ==========
router.post('/search', [
  body('booking_reference')
    .trim()
    .notEmpty().withMessage('Booking reference is required')
    .isLength({ min: 5, max: 20 }).withMessage('Booking reference must be between 5 and 20 characters')
    .matches(/^[A-Z0-9]+$/).withMessage('Booking reference must contain only uppercase letters and numbers'),
  body('last_name')
    .trim()
    .notEmpty().withMessage('Last name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Last name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s'-]+$/).withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes')
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

    const { booking_reference, last_name } = req.body;

    // First, find booking by reference
    const booking = await queryOne(
      `SELECT 
        b.booking_id,
        b.booking_reference,
        b.user_id,
        b.flight_id,
        b.booking_date,
        b.number_of_passengers,
        b.class,
        b.total_amount,
        b.status,
        b.payment_status,
        f.flight_number,
        f.departure_datetime,
        f.arrival_datetime,
        f.status as flight_status,
        dep.airport_code as from_code,
        dep.airport_name as from_name,
        dep.city as from_city,
        arr.airport_code as to_code,
        arr.airport_name as to_name,
        arr.city as to_city
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE b.booking_reference = ?`,
      [booking_reference]
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found. Please check your booking reference.'
      });
    }

    // Verify booking belongs to user (if user is logged in)
    if (req.user.userId !== booking.user_id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: This booking does not belong to you'
      });
    }

    // Check booking status (case-insensitive)
    if ((booking.status || '').toLowerCase() !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `This booking cannot be checked in. Current status: ${booking.status}`
      });
    }

    // Verify last name matches at least one passenger (for security)
    const passengerMatch = await queryOne(
      `SELECT p.last_name 
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       WHERE bp.booking_id = ? AND LOWER(p.last_name) = LOWER(?)`,
      [booking.booking_id, last_name]
    );

    if (!passengerMatch) {
      return res.status(404).json({
        success: false,
        message: 'Last name does not match any passenger in this booking. Please verify the last name of one of the passengers.'
      });
    }

    // Check if already checked in
    const existingCheckIn = await queryOne(
      'SELECT check_in_id, status FROM check_ins WHERE booking_id = ?',
      [booking.booking_id]
    );

    if (existingCheckIn) {
      if (existingCheckIn.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Already checked in',
          data: { booking, alreadyCheckedIn: true }
        });
      }
    }

    // Check if check-in window is open (typically 24 hours before departure)
    const departureTime = new Date(booking.departure_datetime);
    const now = new Date();
    const hoursUntilDeparture = (departureTime - now) / (1000 * 60 * 60);

    if (hoursUntilDeparture < 0) {
      return res.status(400).json({
        success: false,
        message: 'Flight has already departed'
      });
    }

    if (hoursUntilDeparture > 24) {
      return res.status(400).json({
        success: false,
        message: `Check-in opens 24 hours before departure. Check-in will be available ${Math.ceil(hoursUntilDeparture - 24)} hours from now.`
      });
    }

    // Get passengers for this booking
    const passengers = await query(
      `SELECT 
        p.passenger_id,
        p.first_name,
        p.last_name,
        p.date_of_birth,
        p.passport_number,
        p.nationality,
        bp.seat_number,
        bp.booking_passenger_id
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       WHERE bp.booking_id = ?
       ORDER BY bp.booking_passenger_id`,
      [booking.booking_id]
    );

    booking.passengers = passengers || [];

    res.json({
      success: true,
      data: { booking }
    });
  } catch (error) {
    console.error('Check-in search error:', error);
    res.status(500).json({
      success: false,
      message: 'Check-in search failed: ' + error.message
    });
  }
});

// ========== CONFIRM CHECK-IN ==========
router.post('/confirm', [
  body('booking_id')
    .notEmpty().withMessage('Booking ID is required')
    .isInt({ min: 1 }).withMessage('Booking ID must be a positive integer'),
  body('seat_numbers')
    .isArray({ min: 1 }).withMessage('At least one seat number is required')
    .custom((value) => {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Seat numbers must be an array with at least one element');
      }
      for (const seat of value) {
        if (typeof seat !== 'string' || seat.trim().length === 0) {
          throw new Error('Each seat number must be a non-empty string');
        }
      }
      return true;
    }),
  body('gate_number')
    .optional()
    .trim()
    .isLength({ max: 10 }).withMessage('Gate number is too long')
], async (req, res) => {
  const connection = await require('../config/database').pool.getConnection();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    await connection.beginTransaction();

    const { booking_id, seat_numbers, gate_number } = req.body;
    const bookingId = parseInt(booking_id);

    const [metadata] = await connection.execute('SELECT flight_id FROM bookings WHERE booking_id = ? AND user_id = ?', [bookingId, req.user.userId]);
    if (!metadata.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    // Use the same flight-before-booking lock order as holds and disruptions.
    const [flightRows] = await connection.execute('SELECT departure_datetime, aircraft_id, status FROM flights WHERE flight_id = ? FOR UPDATE', [metadata[0].flight_id]);

    // Verify booking exists and belongs to user
    const [bookingRows] = await connection.execute(
      'SELECT * FROM bookings WHERE booking_id = ? AND user_id = ? AND (LOWER(status) = "confirmed") FOR UPDATE',
      [bookingId, req.user.userId]
    );

    if (!bookingRows || bookingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Booking not found or cannot be checked in'
      });
    }

    const bookingData = bookingRows[0];
    if (bookingData.flight_id !== metadata[0].flight_id) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This booking changed. Refresh before checking in.' });
    }

    // Check if already checked in
    const [existingCheckInRows] = await connection.execute(
      'SELECT * FROM check_ins WHERE booking_id = ?',
      [bookingId]
    );

    if (existingCheckInRows && existingCheckInRows.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Already checked in'
      });
    }

    // Verify check-in window
    if (!flightRows || flightRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    if (['cancelled', 'completed', 'in_air'].includes(flightRows[0].status) || bookingData.payment_status !== 'paid') {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This booking is unavailable for check-in' });
    }

    const departureTime = new Date(flightRows[0].departure_datetime);
    const now = new Date();
    const hoursUntilDeparture = (departureTime - now) / (1000 * 60 * 60);

    if (hoursUntilDeparture < 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Flight has already departed'
      });
    }

    if (hoursUntilDeparture > 24) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Check-in opens 24 hours before departure'
      });
    }

    // Calculate boarding time (30 minutes before departure)
    const boardingTime = new Date(departureTime.getTime() - 30 * 60 * 1000);

    // Get passengers for this booking
    const [passengerRows] = await connection.execute(
      'SELECT booking_passenger_id, passenger_id FROM booking_passengers WHERE booking_id = ? ORDER BY booking_passenger_id',
      [bookingId]
    );

    if (passengerRows.length !== seat_numbers.length) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `Number of seat numbers (${seat_numbers.length}) does not match number of passengers (${passengerRows.length})`
      });
    }

    const normalizedSeatNumbers = seat_numbers.map(seat => seat.trim().toUpperCase());

    // Reserve seats in the same transaction as check-in
    await seatAllocationService.processSeatAllocations(
      connection,
      bookingData.flight_id,
      flightRows[0].aircraft_id,
      bookingId,
      req.user.userId,
      normalizedSeatNumbers.map(seat_number => ({ seat_number })),
      bookingData.class
    );

    const placeholders = normalizedSeatNumbers.map(() => '?').join(',');
    await connection.execute(`DELETE FROM flight_seat_allocations WHERE booking_id = ? AND seat_number NOT IN (${placeholders})`, [bookingId, ...normalizedSeatNumbers]);
    await connection.execute(`UPDATE seat_holds SET status = 'CONSUMED' WHERE flight_id = ? AND user_id = ? AND status = 'HELD' AND seat_number IN (${placeholders})`, [bookingData.flight_id, req.user.userId, ...normalizedSeatNumbers]);

    // Create check-in record
    await connection.execute(
      `INSERT INTO check_ins (booking_id, check_in_datetime, gate_number, boarding_time, status)
       VALUES (?, NOW(), ?, ?, 'completed')`,
      [bookingId, gate_number || 'TBA', boardingTime]
    );

    // Update seat numbers for passengers
    for (let i = 0; i < passengerRows.length && i < seat_numbers.length; i++) {
      await connection.execute(
        'UPDATE booking_passengers SET seat_number = ?, boarding_token = ?, boarded_at = NULL WHERE booking_passenger_id = ?',
        [normalizedSeatNumbers[i], require('crypto').randomBytes(32).toString('hex'), passengerRows[i].booking_passenger_id]
      );
    }

    for (let i = 0; i < passengerRows.length; i++) {
      await connection.execute('UPDATE tickets SET seat_number = ? WHERE booking_id = ? AND passenger_id = ? AND status = ?', [normalizedSeatNumbers[i], bookingId, passengerRows[i].passenger_id, 'ISSUED']);
    }

    // Transition booking state to CHECKED_IN via Booking State Machine
    const bookingStateMachine = require('../services/bookingStateMachine');
    await bookingStateMachine.transitionBookingState(
      connection,
      bookingId,
      'CHECKED_IN',
      { type: 'CHECKIN_AGENT', role: 'user' },
      'Online check-in completed'
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Check-in confirmed successfully',
      data: {
        booking_id: bookingId,
        gate_number: gate_number || 'TBA',
        boarding_time: boardingTime
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Check-in confirm error:', error);
    const statusCode = error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500);
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Check-in confirmation failed',
      error: { code: error.code || 'CHECKIN_CONFIRM_FAILED' }
    });
  } finally {
    connection.release();
  }
});

// ========== GET BOARDING PASS ==========
router.get('/boarding-pass/:bookingId', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    if (isNaN(bookingId)) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }

    const booking = await queryOne(
      `SELECT 
        b.booking_id,
        b.booking_reference,
        b.class,
        b.status,
        f.flight_number,
        f.departure_datetime,
        f.arrival_datetime,
        dep.airport_code as from_code,
        dep.city as from_city,
        arr.airport_code as to_code,
        arr.city as to_city,
        ci.gate_number,
        ci.boarding_time
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       INNER JOIN check_ins ci ON b.booking_id = ci.booking_id AND ci.status = 'completed'
       WHERE b.booking_id = ? AND b.user_id = ? AND b.status IN ('CHECKED_IN','BOARDED','COMPLETED')`,
      [bookingId, req.user.userId]
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Boarding pass not found' });
    }

    const passengers = await query(
      `SELECT p.passenger_id, p.first_name, p.last_name, bp.seat_number, bp.boarding_token
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       WHERE bp.booking_id = ?`,
      [bookingId]
    );

    booking.passengers = passengers || [];

    res.json({
      success: true,
      data: { boardingPass: booking }
    });
  } catch (error) {
    console.error('Boarding pass fetch error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve boarding pass: ' + error.message });
  }
});

router.get('/boarding-code/:bookingId/:passengerId', async (req, res) => {
  try {
    const pass = await queryOne(`SELECT bp.boarding_token FROM booking_passengers bp
      JOIN bookings b ON b.booking_id = bp.booking_id JOIN check_ins ci ON ci.booking_id = b.booking_id
      WHERE b.booking_id = ? AND bp.passenger_id = ? AND b.user_id = ? AND ci.status = 'completed'
        AND b.status IN ('CHECKED_IN','BOARDED','COMPLETED')`, [Number(req.params.bookingId), Number(req.params.passengerId), req.user.userId]);
    if (!pass?.boarding_token) return res.status(404).json({ success: false, message: 'Boarding code unavailable' });
    const svg = await require('qrcode').toString(pass.boarding_token, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
    res.set('Cache-Control', 'private, no-store').type('image/svg+xml').send(svg);
  } catch { res.status(500).json({ success: false, message: 'Boarding code could not be generated' }); }
});

module.exports = router;
