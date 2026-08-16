const express = require('express');
const db = require('../config/database');
const { query, queryOne, pool } = db;
const { authenticate } = require('../middleware/auth');
const bookingController = require('../controllers/bookingController');

const router = express.Router();

// All booking routes require authentication
router.use(authenticate);

// ========== TEMPORARY SEAT HOLD ==========
router.post('/hold-seat', (req, res) => bookingController.holdSeat(req, res));

// ========== CREATE BOOKING ==========
router.post('/create', (req, res) => bookingController.createBooking(req, res));

// ========== GET PNR TICKETS ==========
const ticketController = require('../controllers/ticketController');
router.get('/:bookingReference/tickets', (req, res) => ticketController.getTicketsByBookingRef(req, res));

// ========== GET USER BOOKINGS ==========
router.get('/list', async (req, res) => {
  try {
    const { status } = req.query;

    let sql = `
      SELECT 
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
        b.payment_method,
        b.created_at,
        b.updated_at,
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
      WHERE b.user_id = ?
    `;

    const params = [req.user.userId];

    if (status && status !== 'all') {
      sql += ' AND b.status = ?';
      params.push(status);
    }

    sql += ` ORDER BY 
      CASE WHEN f.departure_datetime >= CURRENT_DATE THEN 0 ELSE 1 END ASC,
      CASE WHEN f.departure_datetime >= CURRENT_DATE THEN f.departure_datetime END ASC,
      CASE WHEN f.departure_datetime < CURRENT_DATE THEN f.departure_datetime END DESC`;

    const bookings = await query(sql, params);

    // Fetch passengers and tickets for each booking
    const ticketRepository = require('../repositories/ticketRepository');
    const bookingsWithDetails = await Promise.all(
      (bookings || []).map(async (b) => {
        const passengerRows = await query(
          `SELECT p.passenger_id, p.first_name, p.last_name, bp.seat_number 
           FROM booking_passengers bp 
           INNER JOIN passengers p ON bp.passenger_id = p.passenger_id 
           WHERE bp.booking_id = ?`,
          [b.booking_id]
        );
        const tickets = await ticketRepository.findByBookingId(db.pool, b.booking_id);
        const isUpcoming = new Date(b.departure_datetime) >= new Date(new Date().setHours(0, 0, 0, 0));
        return {
          ...b,
          passengers: passengerRows || [],
          tickets: tickets || [],
          is_upcoming: isUpcoming
        };
      })
    );

    res.json({
      success: true,
      data: { bookings: bookingsWithDetails }
    });
  } catch (error) {
    console.error('List bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve bookings: ' + error.message
    });
  }
});

// ========== GET SINGLE BOOKING ==========
router.get('/:id', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);

    if (isNaN(bookingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const booking = await queryOne(
      `SELECT 
        b.*,
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
       WHERE b.booking_id = ? AND b.user_id = ?`,
      [bookingId, req.user.userId]
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
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
        bp.seat_number
       FROM booking_passengers bp
       INNER JOIN passengers p ON bp.passenger_id = p.passenger_id
       WHERE bp.booking_id = ?`,
      [bookingId]
    );

    booking.passengers = passengers || [];

    res.json({
      success: true,
      data: { booking }
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get booking details: ' + error.message
    });
  }
});

// ========== CANCEL BOOKING ==========
router.post('/:id/cancel', (req, res) => bookingController.cancelBooking(req, res));

// ========== UPDATE BOOKING STATUS ==========
router.post('/:id/update-status', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    const { status } = req.body;

    if (isNaN(bookingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID'
      });
    }

    const statusLower = (status || '').toLowerCase();
    const validStatuses = ['pending', 'confirmed', 'checked_in', 'boarded', 'completed', 'cancelled', 'expired', 'missed'];

    if (!status || !validStatuses.includes(statusLower)) {
      return res.status(400).json({
        success: false,
        message: `Valid status is required (${validStatuses.join(', ')})`
      });
    }

    // Verify booking belongs to user
    const booking = await queryOne(
      'SELECT * FROM bookings WHERE booking_id = ? AND user_id = ?',
      [bookingId, req.user.userId]
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Update booking status
    await query(
      'UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE booking_id = ?',
      [status, bookingId]
    );

    res.json({
      success: true,
      message: 'Booking status updated successfully'
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status: ' + error.message
    });
  }
});

// ========== PAY FOR PENDING BOOKING ==========
router.post('/:id/pay', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id);
    const userId = req.user.userId;
    const paymentMethod = req.body.payment_method || 'Credit Card';

    const booking = await queryOne(
      'SELECT * FROM bookings WHERE booking_id = ? AND user_id = ?',
      [bookingId, userId]
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status.toUpperCase() !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Booking is in ${booking.status} status and cannot be paid.` });
    }

    const bookingStateMachine = require('../services/bookingStateMachine');
    const ticketService = require('../services/ticketService');
    const db = require('../config/database');
    const connection = await db.pool.getConnection();

    try {
      await connection.beginTransaction();

      await bookingStateMachine.transitionBookingState(
        connection,
        bookingId,
        'CONFIRMED',
        { userId, role: 'user', type: 'BOOKING_SERVICE' },
        `Customer completed payment via ${paymentMethod}`
      );

      await connection.execute(
        `UPDATE bookings SET payment_status = 'paid', payment_method = ? WHERE booking_id = ?`,
        [paymentMethod, bookingId]
      );

      const [passengers] = await connection.execute(
        `SELECT bp.passenger_id, bp.seat_number FROM booking_passengers bp WHERE bp.booking_id = ?`,
        [bookingId]
      );

      await ticketService.issueTicketsForBooking(
        connection,
        bookingId,
        booking.flight_id,
        booking.class,
        passengers,
        userId
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'Payment completed successfully! Booking is now CONFIRMED.'
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Pay pending booking error:', error);
    res.status(500).json({ success: false, message: 'Payment failed: ' + error.message });
  }
});

// ========== FLIGHT REBOOKING ENDPOINTS ==========
const rebookingService = require('../services/rebookingService');
const rebookingRepository = require('../repositories/rebookingRepository');

// 1. Get Eligible Alternatives
router.get('/:id/rebook/alternatives', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const result = await rebookingService.getEligibleAlternatives(bookingId, req.user);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Rebooking alternatives error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to fetch alternative flights',
      error: { code: error.code || 'ALTERNATIVES_FETCH_FAILED' }
    });
  }
});

// 2. Rebooking Preview
router.post('/:id/rebook/preview', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const { new_flight_id, new_seats } = req.body;
    if (!new_flight_id) {
      return res.status(400).json({
        success: false,
        message: 'new_flight_id is required'
      });
    }

    const preview = await rebookingService.previewRebooking(
      bookingId,
      parseInt(new_flight_id, 10),
      new_seats || [],
      req.user
    );

    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    console.error('Rebooking preview error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Rebooking preview failed',
      error: { code: error.code || 'PREVIEW_FAILED' }
    });
  }
});

// 3. Execute Rebooking (Supports Idempotency-Key header)
router.post('/:id/rebook', async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const { new_flight_id, new_seats, reason } = req.body;

  if (!new_flight_id) {
    return res.status(400).json({
      success: false,
      message: 'new_flight_id is required'
    });
  }

  const rebookingKey = req.headers['idempotency-key'] || req.body.rebooking_key || null;
  const connection = await require('../config/database').pool.getConnection();

  try {
    await connection.beginTransaction();

    const result = await rebookingService.executeRebooking(
      connection,
      bookingId,
      parseInt(new_flight_id, 10),
      new_seats || [],
      reason || 'CUSTOMER_REQUEST',
      req.user,
      rebookingKey
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Flight rebooked successfully',
      data: result
    });
  } catch (error) {
    await connection.rollback();
    console.error('Rebooking execution error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Rebooking failed',
      error: { code: error.code || 'REBOOKING_FAILED' }
    });
  } finally {
    connection.release();
  }
});

// 4. Rebooking History
router.get('/:id/rebook/history', async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const history = await rebookingRepository.getHistoryByBooking(null, bookingId);
    res.json({
      success: true,
      data: { history }
    });
  } catch (error) {
    console.error('Rebooking history error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rebooking history: ' + error.message
    });
  }
});

module.exports = router;
