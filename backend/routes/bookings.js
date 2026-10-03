const express = require('express');
const db = require('../config/database');
const { query, queryOne, pool } = db;
const { authenticate } = require('../middleware/auth');
const bookingController = require('../controllers/bookingController');

const router = require('../middleware/asyncRouter')();

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
        b.itinerary_id,
        b.segment_index,
        b.user_id,
        b.flight_id,
        b.booking_date,
        b.number_of_passengers,
        b.class,
        b.total_amount,
        b.status,
        b.payment_status,
        b.payment_method,
        b.refund_status,
        b.reservation_expires_at,
        b.created_at,
        b.updated_at,
        f.flight_number,
        f.departure_datetime,
        f.arrival_datetime,
        f.status as flight_status,
        (${require('../services/metricSql').upcomingBooking}) AS is_upcoming,
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
    if (!bookings || bookings.length === 0) {
      return res.json({
        success: true,
        data: { bookings: [] }
      });
    }

    const bookingIds = bookings.map(b => b.booking_id);
    const ticketRepository = require('../repositories/ticketRepository');
    const placeholders = bookingIds.map(() => '?').join(',');

    // Fetch passengers and tickets in batch (2 ultra-fast parallel queries)
    const [passengerRows, allTickets] = await Promise.all([
      query(
        `SELECT bp.booking_id, p.passenger_id, p.first_name, p.last_name, bp.seat_number 
         FROM booking_passengers bp 
         INNER JOIN passengers p ON bp.passenger_id = p.passenger_id 
         WHERE bp.booking_id IN (${placeholders})`,
        bookingIds
      ),
      ticketRepository.findByBookingIds(db.pool, bookingIds)
    ]);

    const passengerMap = new Map();
    (passengerRows || []).forEach(p => {
      if (!passengerMap.has(p.booking_id)) passengerMap.set(p.booking_id, []);
      passengerMap.get(p.booking_id).push(p);
    });

    const ticketMap = new Map();
    (allTickets || []).forEach(t => {
      if (!ticketMap.has(t.booking_id)) ticketMap.set(t.booking_id, []);
      ticketMap.get(t.booking_id).push(t);
    });

    const bookingsWithDetails = bookings.map(b => ({
      ...b,
      passengers: passengerMap.get(b.booking_id) || [],
      tickets: ticketMap.get(b.booking_id) || []
    }));

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

router.get('/payment-options', (req, res) => {
  res.json({ success: true, data: { demo_enabled: require('../services/paymentService').demoEnabled() } });
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

// Legacy clients must use the dedicated payment, cancellation, check-in, and
// authorized operational actions. Never accept arbitrary customer state writes.
router.post('/:id/update-status', (req, res) => {
  res.status(403).json({
    success: false,
    message: 'Booking status changes require a dedicated booking action.',
    error: { code: 'BOOKING_STATUS_UPDATE_FORBIDDEN' }
  });
});

// Explicit development-only demo confirmation. Real payments require a provider integration.
router.post('/:id/pay', async (req, res) => {
  try {
    const data = await require('../services/paymentService').confirmDemoPayment(req.user.userId, Number(req.params.id));
    res.json({ success: true, message: 'Demo booking confirmed; no money collected.', data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Payment confirmation failed', error: { code: error.code || 'PAYMENT_FAILED' } });
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
    const bookingId = Number(req.params.id);
    if (!Number.isSafeInteger(bookingId) || bookingId < 1) {
      return res.status(400).json({ success: false, message: 'Invalid booking ID' });
    }
    const booking = await queryOne(
      req.user.role === 'admin'
        ? 'SELECT booking_id FROM bookings WHERE booking_id = ?'
        : 'SELECT booking_id FROM bookings WHERE booking_id = ? AND user_id = ?',
      req.user.role === 'admin' ? [bookingId] : [bookingId, req.user.userId]
    );
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
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
