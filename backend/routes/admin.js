const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = require('../middleware/asyncRouter')();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// ========== STATISTICS ==========
router.get('/stats', async (req, res) => {
  try {

    res.json({ success:true, data:await require('../services/metricsService').adminStats() });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get statistics: ' + error.message
    });
  }
});

// ========== FLIGHTS MANAGEMENT ==========

// Get all flights with pagination
router.get('/flights', async (req, res) => {
  try {
    console.log('Admin flights request:', { page: req.query.page, limit: req.query.limit, search: req.query.search });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200)); // Max 500
    const offset = Math.max(0, (page - 1) * limit);
    const search = (req.query.search || '').trim();

    // Build search condition
    let searchCondition = '';
    const params = [];
    
    if (search) {
      searchCondition = `AND (
        f.flight_number LIKE ? OR
        f.from_airport_code LIKE ? OR
        f.to_airport_code LIKE ? OR
        dep.city LIKE ? OR
        dep.airport_name LIKE ? OR
        arr.city LIKE ? OR
        arr.airport_name LIKE ? OR
        a.model LIKE ? OR
        f.status LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Get total count for pagination
    const countResults = await query(
      `SELECT COUNT(*) as total 
       FROM flights f
       LEFT JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       LEFT JOIN airports dep ON f.from_airport_code = dep.airport_code
       LEFT JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE 1=1 ${searchCondition}`,
      params
    );

    const total = countResults && countResults[0] ? countResults[0].total : 0;
    const totalPages = Math.ceil(total / limit);

    // Ensure limit and offset are integers (MySQL doesn't support parameterized LIMIT/OFFSET)
    const safeLimit = parseInt(limit) || 50;
    const safeOffset = parseInt(offset) || 0;

    // Get flights with pagination
    const flights = await query(
      `SELECT 
        f.flight_id,
        f.flight_number,
        f.aircraft_id,
        f.from_airport_code,
        f.to_airport_code,
        f.departure_datetime,
        f.arrival_datetime,
        f.status,
        (${require('../services/metricSql').upcomingFlight}) AS is_upcoming,
        f.base_price,
        f.business_price,
        f.first_class_price,
        f.created_at,
        f.updated_at,
        COALESCE(a.model, 'Standard Jet') as aircraft_model,
        COALESCE(a.capacity, 180) as capacity,
        COALESCE(dep.airport_name, f.from_airport_code) as from_name,
        COALESCE(dep.city, f.from_airport_code) as from_city,
        COALESCE(dep.country, '') as from_country,
        COALESCE(arr.airport_name, f.to_airport_code) as to_name,
        COALESCE(arr.city, f.to_airport_code) as to_city,
        COALESCE(arr.country, '') as to_country
       FROM flights f
       LEFT JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       LEFT JOIN airports dep ON f.from_airport_code = dep.airport_code
       LEFT JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE 1=1 ${searchCondition}
       ORDER BY f.departure_datetime DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    console.log(`Returning ${flights.length} flights (page ${page}, total: ${total})`);

    res.json({
      success: true,
      data: { 
        flights: flights || [],
        pagination: {
          page,
          limit,
          total,
          totalPages
        }
      }
    });
  } catch (error) {
    console.error('Get flights error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to get flights: ' + error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Create new flight
router.post('/flights', async (req, res) => {
  try {
    const flightId = await require('../services/flightManagementService').createFlight(req.body);
    res.status(201).json({ success: true, message: 'Flight created', data: { flight_id: flightId } });
  } catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Flight creation failed' }); }
});

// Update flight
router.put('/flights/:id', async (req, res) => {
  try {
    await require('../services/flightManagementService').updateFlight(Number(req.params.id), req.body, req.user);
    res.json({ success: true, message: 'Flight updated successfully' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Flight update failed; changes rolled back' });
  }
});

// Delete flight
router.delete('/flights/:id', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id);
    
    if (isNaN(flightId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid flight ID'
      });
    }

    // Check if flight exists
    const flight = await queryOne('SELECT flight_id FROM flights WHERE flight_id = ?', [flightId]);
    if (!flight) {
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    // Check if flight has active bookings
    const bookingsResult = await queryOne(
      'SELECT COUNT(*) as count FROM bookings WHERE flight_id = ? AND status NOT IN ("cancelled", "completed")',
      [flightId]
    );

    const activeBookings = bookingsResult?.count || 0;
    if (activeBookings > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete flight with ${activeBookings} active booking(s). Cancel bookings first.`
      });
    }

    // Delete the flight
    await query('DELETE FROM flights WHERE flight_id = ?', [flightId]);

    res.json({
      success: true,
      message: 'Flight deleted successfully'
    });
  } catch (error) {
    console.error('Delete flight error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete flight: ' + error.message
    });
  }
});

// ========== BOOKINGS MANAGEMENT ==========

// Get single booking (admin)
router.get('/bookings/:id', async (req, res) => {
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
        u.first_name as user_first_name,
        u.last_name as user_last_name,
        u.email as user_email,
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
       INNER JOIN users u ON b.user_id = u.user_id
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE b.booking_id = ?`,
      [bookingId]
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

// Get all bookings
router.get('/bookings', async (req, res) => {
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
        b.refund_status,
        b.reservation_expires_at,
        b.created_at,
        b.updated_at,
        u.first_name as user_first_name,
        u.last_name as user_last_name,
        u.email as user_email,
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
      LEFT JOIN users u ON b.user_id = u.user_id
      LEFT JOIN flights f ON b.flight_id = f.flight_id
      LEFT JOIN airports dep ON f.from_airport_code = dep.airport_code
      LEFT JOIN airports arr ON f.to_airport_code = arr.airport_code
      WHERE 1=1
    `;

    const params = [];

    if (status && status.toLowerCase() !== 'all') {
      sql += ' AND LOWER(b.status) = LOWER(?)';
      params.push(status);
    }

    sql += ` ORDER BY 
      CASE WHEN f.departure_datetime >= CURRENT_DATE THEN 0 ELSE 1 END ASC,
      CASE WHEN f.departure_datetime >= CURRENT_DATE THEN f.departure_datetime END ASC,
      f.departure_datetime DESC`;

    const bookings = await query(sql, params);
    res.json({
      success: true,
      data: { bookings: bookings || [] }
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bookings: ' + error.message
    });
  }
});

// ========== BOOKINGS MANAGEMENT ==========

// Update booking status
router.put('/bookings/:id/status', async (req, res) => {
  if (String(req.body.status).toUpperCase() !== 'CANCELLED' || req.body.payment_status !== undefined) {
    return res.status(403).json({ success: false, message: 'Use dedicated payment, check-in, boarding, or rebooking actions.' });
  }
  try {
    const owner = await queryOne('SELECT user_id FROM bookings WHERE booking_id = ?', [Number(req.params.id)]);
    if (!owner) return res.status(404).json({ success: false, message: 'Booking not found' });
    await require('../services/bookingService').cancelBooking(owner.user_id, Number(req.params.id), { requestingUser: req.user, reason: 'Cancelled by administrator', allowOverride: true });
    res.json({ success: true, message: 'Booking cancelled; any real refund requires provider processing' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Cancellation failed' });
  }
});

// ========== USERS MANAGEMENT ==========

// Get all users
router.get('/users', async (req, res) => {
  try {
    const users = await query(
      `SELECT 
        user_id,
        first_name,
        last_name,
        email,
        phone,
        date_of_birth,
        address,
        role,
        status,
        created_at,
        updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      data: { users: users || [] }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users: ' + error.message
    });
  }
});

// Update user status
router.put('/users/:id/status', [
  body('status')
    .isIn(['active', 'inactive', 'suspended']).withMessage('Invalid status')
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

    const userId = parseInt(req.params.id);
    const { status } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user.userId && status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own status'
      });
    }

    // Check if user exists
    const user = await queryOne('SELECT user_id, role FROM users WHERE user_id = ?', [userId]);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent changing admin status
    if (user.role === 'admin' && status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate admin users'
      });
    }

    await query(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [status, userId]
    );

    res.json({
      success: true,
      message: 'User status updated successfully'
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status: ' + error.message
    });
  }
});

// ========== AIRCRAFT MANAGEMENT ==========

// Get all aircraft
router.get('/aircraft', async (req, res) => {
  try {
    const aircraft = await query(
      `SELECT 
        aircraft_id,
        model,
        registration,
        capacity,
        status,
        created_at,
        updated_at
       FROM aircraft
       ORDER BY model, registration`
    );

    res.json({
      success: true,
      data: { aircraft: aircraft || [] }
    });
  } catch (error) {
    console.error('Get aircraft error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get aircraft: ' + error.message
    });
  }
});

// Create aircraft
router.post('/aircraft', [
  body('model')
    .trim()
    .notEmpty().withMessage('Model is required')
    .isLength({ max: 100 }).withMessage('Model name is too long'),
  body('registration')
    .trim()
    .notEmpty().withMessage('Registration is required')
    .isLength({ max: 20 }).withMessage('Registration is too long')
    .matches(/^[A-Z0-9\-]+$/).withMessage('Registration must contain only uppercase letters, numbers, and hyphens'),
  body('capacity')
    .isInt({ min: 1, max: 1000 }).withMessage('Capacity must be between 1 and 1000'),
  body('status')
    .optional({ values: 'falsy' })
    .isIn(['active', 'maintenance', 'retired']).withMessage('Invalid status')
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

    const { model, registration, capacity, status = 'active' } = req.body;

    // Check if registration already exists
    const existingAircraft = await queryOne(
      'SELECT aircraft_id FROM aircraft WHERE registration = ?',
      [registration.toUpperCase()]
    );

    if (existingAircraft) {
      return res.status(409).json({
        success: false,
        message: 'Aircraft with this registration already exists'
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO aircraft (model, registration, capacity, status)
       VALUES (?, ?, ?, ?)`,
      [model, registration.toUpperCase(), parseInt(capacity), status]
    );

    res.status(201).json({
      success: true,
      message: 'Aircraft created successfully',
      data: {
        aircraftId: result.insertId,
        model,
        registration: registration.toUpperCase(),
        capacity: parseInt(capacity),
        status
      }
    });
  } catch (error) {
    console.error('Create aircraft error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create aircraft: ' + error.message
    });
  }
});

// Update aircraft
router.put('/aircraft/:id', [
  body('model')
    .optional({ values: 'falsy' })
    .trim()
    .notEmpty().withMessage('Model cannot be empty')
    .isLength({ max: 100 }).withMessage('Model name is too long'),
  body('registration')
    .optional({ values: 'falsy' })
    .trim()
    .notEmpty().withMessage('Registration cannot be empty')
    .isLength({ max: 20 }).withMessage('Registration is too long')
    .matches(/^[A-Z0-9\-]+$/).withMessage('Registration must contain only uppercase letters, numbers, and hyphens'),
  body('capacity')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 1000 }).withMessage('Capacity must be between 1 and 1000'),
  body('status')
    .optional({ values: 'falsy' })
    .isIn(['active', 'maintenance', 'retired']).withMessage('Invalid status')
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

    const aircraftId = parseInt(req.params.id);
    const { model, registration, capacity, status } = req.body;

    if (isNaN(aircraftId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid aircraft ID'
      });
    }

    // Check if aircraft exists
    const aircraft = await queryOne('SELECT aircraft_id FROM aircraft WHERE aircraft_id = ?', [aircraftId]);
    if (!aircraft) {
      return res.status(404).json({
        success: false,
        message: 'Aircraft not found'
      });
    }

    // Build update query
    const updates = [];
    const params = [];

    if (model) {
      updates.push('model = ?');
      params.push(model);
    }

    if (registration) {
      // Check if new registration conflicts
      const conflict = await queryOne(
        'SELECT aircraft_id FROM aircraft WHERE registration = ? AND aircraft_id != ?',
        [registration.toUpperCase(), aircraftId]
      );
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: 'Aircraft registration already exists'
        });
      }
      updates.push('registration = ?');
      params.push(registration.toUpperCase());
    }

    if (capacity !== undefined) {
      updates.push('capacity = ?');
      params.push(parseInt(capacity));
    }

    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    params.push(aircraftId);

    await query(
      `UPDATE aircraft SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE aircraft_id = ?`,
      params
    );

    res.json({
      success: true,
      message: 'Aircraft updated successfully'
    });
  } catch (error) {
    console.error('Update aircraft error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update aircraft: ' + error.message
    });
  }
});

// Delete aircraft
router.delete('/aircraft/:id', async (req, res) => {
  try {
    const aircraftId = parseInt(req.params.id);

    if (isNaN(aircraftId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid aircraft ID'
      });
    }

    // Check if aircraft exists
    const aircraft = await queryOne('SELECT aircraft_id FROM aircraft WHERE aircraft_id = ?', [aircraftId]);
    if (!aircraft) {
      return res.status(404).json({
        success: false,
        message: 'Aircraft not found'
      });
    }

    // Check if aircraft is used in flights
    const flightsResult = await queryOne(
      'SELECT COUNT(*) as count FROM flights WHERE aircraft_id = ?',
      [aircraftId]
    );

    const flightCount = flightsResult?.count || 0;
    if (flightCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete aircraft used in ${flightCount} flight(s)`
      });
    }

    // Delete the aircraft
    await query('DELETE FROM aircraft WHERE aircraft_id = ?', [aircraftId]);

    res.json({
      success: true,
      message: 'Aircraft deleted successfully'
    });
  } catch (error) {
    console.error('Delete aircraft error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete aircraft: ' + error.message
    });
  }
});

// ========== AIRPORTS MANAGEMENT ==========

// Get all airports with linked flight counts
router.get('/airports', async (req, res) => {
  try {
    const airports = await query(`
      SELECT 
        a.airport_code,
        a.airport_name,
        a.city,
        a.country,
        a.created_at,
        (
          SELECT COUNT(*) 
          FROM flights f 
          WHERE f.from_airport_code = a.airport_code OR f.to_airport_code = a.airport_code
        ) as linked_flights_count
      FROM airports a
      ORDER BY a.city ASC
    `);

    res.json({
      success: true,
      data: { airports: airports || [] }
    });
  } catch (error) {
    console.error('Get admin airports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get airports: ' + error.message
    });
  }
});

// Create new airport
router.post('/airports', [
  body('airport_code')
    .trim()
    .notEmpty().withMessage('Airport code is required')
    .isLength({ min: 3, max: 3 }).withMessage('Airport code must be exactly 3 characters')
    .matches(/^[A-Za-z]{3}$/).withMessage('Airport code must contain exactly 3 letters (e.g. JFK)'),
  body('airport_name')
    .trim()
    .notEmpty().withMessage('Airport name is required')
    .isLength({ max: 255 }).withMessage('Airport name is too long'),
  body('city')
    .trim()
    .notEmpty().withMessage('City is required')
    .isLength({ max: 100 }).withMessage('City name is too long'),
  body('country')
    .trim()
    .notEmpty().withMessage('Country is required')
    .isLength({ max: 100 }).withMessage('Country name is too long')
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

    const { airport_code, airport_name, city, country } = req.body;
    const cleanCode = airport_code.trim().toUpperCase();

    // Check if airport code already exists
    const existing = await queryOne(
      'SELECT airport_code FROM airports WHERE airport_code = ?',
      [cleanCode]
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Airport with code "${cleanCode}" already exists`
      });
    }

    await query(
      'INSERT INTO airports (airport_code, airport_name, city, country) VALUES (?, ?, ?, ?)',
      [cleanCode, airport_name.trim(), city.trim(), country.trim()]
    );

    res.status(201).json({
      success: true,
      message: `Airport ${cleanCode} (${airport_name.trim()}) created successfully`,
      data: {
        airport: {
          airport_code: cleanCode,
          airport_name: airport_name.trim(),
          city: city.trim(),
          country: country.trim()
        }
      }
    });
  } catch (error) {
    console.error('Create airport error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create airport: ' + error.message
    });
  }
});

// Delete an airport
router.delete('/airports/:code', async (req, res) => {
  try {
    const airportCode = (req.params.code || '').trim().toUpperCase();

    if (!airportCode || airportCode.length !== 3) {
      return res.status(400).json({
        success: false,
        message: 'Invalid airport code'
      });
    }

    // Check if airport exists
    const airport = await queryOne(
      'SELECT airport_code, airport_name, city FROM airports WHERE airport_code = ?',
      [airportCode]
    );

    if (!airport) {
      return res.status(404).json({
        success: false,
        message: `Airport ${airportCode} not found`
      });
    }

    // Check if airport is linked to any flights
    const linkedFlights = await queryOne(
      `SELECT COUNT(*) as count 
       FROM flights 
       WHERE from_airport_code = ? OR to_airport_code = ?`,
      [airportCode, airportCode]
    );

    const flightCount = linkedFlights?.count || 0;
    if (flightCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete airport ${airportCode} because it is referenced in ${flightCount} flight route(s). Remove or update those flights first.`
      });
    }

    // Delete airport
    await query('DELETE FROM airports WHERE airport_code = ?', [airportCode]);

    res.json({
      success: true,
      message: `Airport ${airportCode} (${airport.airport_name}) deleted successfully`
    });
  } catch (error) {
    console.error('Delete airport error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete airport: ' + error.message
    });
  }
});

// ========== HOT FLIGHTS ==========

// Get hot flights (most booked flights)
router.get('/hot-flights', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    
    const hotFlights = await query(
      `SELECT 
        f.flight_id,
        f.flight_number,
        f.departure_datetime,
        f.arrival_datetime,
        f.status,
        f.base_price,
        f.business_price,
        f.first_class_price,
        dep.airport_code as from_code,
        dep.airport_name as from_name,
        dep.city as from_city,
        dep.country as from_country,
        arr.airport_code as to_code,
        arr.airport_name as to_name,
        arr.city as to_city,
        arr.country as to_country,
        COUNT(b.booking_id) as booking_count,
        COALESCE(SUM(b.total_amount), 0) as total_revenue,
        a.model as aircraft_model,
        a.capacity
       FROM flights f
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       LEFT JOIN bookings b ON f.flight_id = b.flight_id AND LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed')
       WHERE f.departure_datetime >= CURRENT_DATE
       GROUP BY f.flight_id, f.flight_number, f.departure_datetime, f.arrival_datetime, 
                f.status, f.base_price, f.business_price, f.first_class_price,
                dep.airport_code, dep.airport_name, dep.city, dep.country,
                arr.airport_code, arr.airport_name, arr.city, arr.country,
                a.model, a.capacity
       ORDER BY booking_count DESC, total_revenue DESC
       LIMIT ?`,
      [limit]
    );

    // Calculate occupancy rate for each flight
    const flightsWithOccupancy = await Promise.all(
      (hotFlights || []).map(async (flight) => {
        const bookedSeats = await queryOne(
          `SELECT COUNT(*) as total 
           FROM booking_passengers bp
           INNER JOIN bookings b ON bp.booking_id = b.booking_id
           WHERE b.flight_id = ? AND b.status != 'cancelled'`,
          [flight.flight_id]
        );
        
        const occupancyRate = flight.capacity > 0
          ? Math.round(((bookedSeats?.total || 0) / flight.capacity) * 100)
          : 0;
        
        return {
          ...flight,
          booking_count: flight.booking_count || 0,
          total_revenue: parseFloat(flight.total_revenue || 0),
          booked_seats: bookedSeats?.total || 0,
          occupancy_rate: occupancyRate
        };
      })
    );

    res.json({
      success: true,
      data: { hotFlights: flightsWithOccupancy }
    });
  } catch (error) {
    console.error('Get hot flights error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get hot flights: ' + error.message
    });
  }
});

// ========== GET AUDIT LOGS (ADMIN ONLY) ==========
const auditService = require('../services/auditService');

router.get('/audit-logs', async (req, res) => {
  try {
    const filters = {
      user_id: req.query.user_id,
      action: req.query.action,
      resource_type: req.query.resource_type,
      resource_id: req.query.resource_id,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      ip_address: req.query.ip_address,
      request_id: req.query.request_id,
      status: req.query.status
    };

    const pagination = {
      page: req.query.page,
      limit: req.query.limit
    };

    const result = await auditService.getAuditLogs(filters, pagination, req.user);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get audit logs error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      error: { code: error.code || 'AUDIT_QUERY_FAILED', message: error.message || 'Failed to fetch audit logs' }
    });
  }
});

// ========== ADMIN BOOKING STATE TRANSITION / OVERRIDE ==========
const bookingStateMachine = require('../services/bookingStateMachine');

router.patch('/bookings/:id/state', async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const { status, reason, allow_override } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'Target status is required'
    });
  }

  const connection = await require('../config/database').pool.getConnection();

  try {
    await connection.beginTransaction();

    const actor = {
      type: 'ADMIN',
      userId: req.user.userId,
      role: 'admin'
    };

    const updatedBooking = await bookingStateMachine.transitionBookingState(
      connection,
      bookingId,
      status,
      actor,
      reason,
      { allowOverride: allow_override === true }
    );

    await connection.commit();

    res.json({
      success: true,
      message: `Booking state successfully updated to ${updatedBooking.status}`,
      data: { booking: updatedBooking }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Admin booking state update error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to update booking state',
      error: { code: error.code || 'STATE_TRANSITION_FAILED' }
    });
  } finally {
    connection.release();
  }
});

// ========== FLIGHT DISRUPTION MANAGEMENT ENDPOINTS ==========
const disruptionService = require('../services/disruptionService');
const disruptionRepository = require('../repositories/disruptionRepository');

// 1. Impact Preview
router.get('/disruptions/impact-preview', async (req, res) => {
  try {
    const flightId = parseInt(req.query.flight_id, 10);
    const disruptionType = req.query.disruption_type;

    if (!flightId || !disruptionType) {
      return res.status(400).json({
        success: false,
        message: 'flight_id and disruption_type query parameters are required'
      });
    }

    const preview = await disruptionService.calculateImpact(flightId, disruptionType, req.query);
    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    console.error('Impact preview error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to calculate disruption impact',
      error: { code: error.code || 'IMPACT_PREVIEW_FAILED' }
    });
  }
});

// 2. Execute Disruption (Supports Idempotency-Key header)
router.post('/disruptions/execute', async (req, res) => {
  const { flight_id, disruption_type, reason } = req.body;
  if (!flight_id || !disruption_type || !reason) {
    return res.status(400).json({
      success: false,
      message: 'flight_id, disruption_type, and reason are required'
    });
  }

  const executionKey = req.headers['idempotency-key'] || req.body.execution_key || null;
  const connection = await require('../config/database').pool.getConnection();

  try {
    await connection.beginTransaction();

    const actor = {
      type: 'ADMIN',
      userId: req.user.userId,
      role: 'admin'
    };

    const result = await disruptionService.executeDisruption(
      connection,
      parseInt(flight_id, 10),
      req.body,
      actor,
      executionKey
    );

    await connection.commit();

    res.json({
      success: true,
      message: `Disruption [${disruption_type}] executed successfully for Flight #${flight_id}`,
      data: result
    });
  } catch (error) {
    await connection.rollback();
    console.error('Disruption execution error:', error.message);
    const statusCode = error.status || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to execute disruption',
      error: { code: error.code || 'DISRUPTION_EXECUTION_FAILED' }
    });
  } finally {
    connection.release();
  }
});

// 3. Disruption History
router.get('/disruptions/history/:flightId', async (req, res) => {
  try {
    const flightId = parseInt(req.params.flightId, 10);
    const history = await disruptionRepository.getDisruptionsByFlight(null, flightId);
    res.json({
      success: true,
      data: { disruptions: history }
    });
  } catch (error) {
    console.error('Disruption history error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch disruption history: ' + error.message
    });
  }
});

module.exports = router;
