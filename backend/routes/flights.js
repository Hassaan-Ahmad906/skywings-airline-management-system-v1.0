const express = require('express');
const { query } = require('../config/database');

const router = require('../middleware/asyncRouter')();

// ========== SEARCH FLIGHTS ==========
router.get('/itinerary-search', async (req, res) => {
  let legs;
  try { legs = JSON.parse(req.query.legs || 'null'); } catch { return res.status(400).json({ success:false, message:'Invalid flight legs' }); }
  const data = await require('../services/journeySearchService').search(legs, req.query.trip_type || 'oneway', req.query.class || 'economy', req.query.passengers || 1);
  res.json({ success:true, data });
});
router.get('/search', async (req, res) => {
  try {
    const { from, to, departure, return: returnDate, passengers = 1, class: flightClass = 'economy' } = req.query;

    if (returnDate) return res.status(400).json({ success: false, message: 'Search one-way flights; book the return journey separately.' });
    if (!['economy','business','first'].includes(flightClass) || !Number.isInteger(Number(passengers)) || Number(passengers) < 1 || Number(passengers) > 9 ||
      [from,to].some(code => code && !/^[A-Z]{3}$/.test(code)) || (from && from === to) ||
      (departure && (!/^\d{4}-\d{2}-\d{2}$/.test(departure) || !Number.isFinite(new Date(departure+'T00:00:00Z').getTime()) || new Date(departure+'T00:00:00Z').toISOString().slice(0,10) !== departure))) {
      return res.status(400).json({ success: false, message: 'Provide valid airports, date, cabin, and 1?9 passengers.' });
    }
    let sql = `
      SELECT 
        f.flight_id,
        f.flight_number,
        f.departure_datetime,
        f.arrival_datetime,
        f.status,
        f.base_price,
        f.business_price,
        f.first_class_price,
        f.aircraft_id,
        a.model as aircraft_model,
        a.capacity,
        dep.airport_code as from_code,
        dep.airport_name as from_name,
        dep.city as from_city,
        dep.country as from_country,
        arr.airport_code as to_code,
        arr.airport_name as to_name,
        arr.city as to_city,
        arr.country as to_country,
        CASE 
          WHEN ? = 'economy' THEN f.base_price
          WHEN ? = 'business' THEN f.business_price
          WHEN ? = 'first' THEN f.first_class_price
          ELSE f.base_price
        END as price,
        ${require('../repositories/inventorySql')} as available_seats
      FROM flights f
      INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
      INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
      INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
      WHERE f.status IN ('scheduled', 'boarding', 'delayed') AND a.status = 'active'
        AND f.departure_datetime > CURRENT_TIMESTAMP
    `;

    const params = Array(6).fill(flightClass);

    if (from) {
      sql += ' AND f.from_airport_code = ?';
      params.push(from);
    }

    if (to) {
      sql += ' AND f.to_airport_code = ?';
      params.push(to);
    }

    if (departure) {
      sql += ' AND DATE(f.departure_datetime) = ?';
      params.push(departure);
    }

    sql += ' HAVING available_seats >= ? ORDER BY f.departure_datetime ASC LIMIT 200';
    params.push(Number(passengers));

    const flights = await query(sql, params);

    for (let flight of flights) {
      flight.available_seats = Number(flight.available_seats);
      flight.total_price = parseFloat(flight.price) * parseInt(passengers);
    }

    res.json({
      success: true,
      message: 'Flights retrieved successfully',
      data: {
        flights: flights || [],
        search_params: {
          from,
          to,
          departure,
          return: returnDate,
          passengers: parseInt(passengers),
          class: flightClass
        }
      }
    });
  } catch (error) {
    console.error('Flight search error:', error);
    res.status(500).json({
      success: false,
      message: 'Flight search failed: ' + error.message
    });
  }
});

// ========== GET ALL AIRPORTS ==========
router.get('/airports', async (req, res) => {
  try {
    const airports = await query('SELECT * FROM airports ORDER BY city ASC');
    res.json({
      success: true,
      data: { airports: airports || [] }
    });
  } catch (error) {
    console.error('Get airports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch airports: ' + error.message
    });
  }
});

// ========== GET SINGLE FLIGHT ==========
router.get('/:id', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id);

    if (isNaN(flightId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid flight ID'
      });
    }

    const flights = await query(
      `SELECT 
        f.*,
        a.model as aircraft_model,
        a.capacity,
        dep.airport_code as from_code,
        dep.airport_name as from_name,
        dep.city as from_city,
        dep.country as from_country,
        arr.airport_code as to_code,
        arr.airport_name as to_name,
        arr.city as to_city,
        arr.country as to_country
       FROM flights f
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       WHERE f.flight_id = ?`,
      [flightId]
    );

    if (!flights || flights.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    // Calculate real available seats
    const bookedPaxRows = await query(
      `SELECT COALESCE(SUM(b.number_of_passengers), 0) as booked_pax
       FROM bookings b
       WHERE b.flight_id = ? AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'PENDING')`,
      [flightId]
    );
    const allocatedSeatRows = await query(
      `SELECT COUNT(*) as allocated_seats
       FROM flight_seat_allocations
       WHERE flight_id = ?`,
      [flightId]
    );

    const bookedPax = parseInt(bookedPaxRows[0]?.booked_pax) || 0;
    const allocatedSeats = parseInt(allocatedSeatRows[0]?.allocated_seats) || 0;
    const totalOccupied = Math.max(bookedPax, allocatedSeats);

    flights[0].available_seats = Math.max(0, (flights[0].capacity || 150) - totalOccupied);

    res.json({
      success: true,
      data: { flight: flights[0] }
    });
  } catch (error) {
    console.error('Get flight error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get flight details: ' + error.message
    });
  }
});

// ========== GET FLIGHT STATUS ==========
router.get('/status/:flightNumber', async (req, res) => {
  try {
    const { flightNumber } = req.params;

    const flights = await query(
      `SELECT 
        f.*,
        a.model as aircraft_model,
        dep.airport_code as from_airport_code,
        dep.airport_name as from_name,
        dep.city as from_city,
        dep.country as from_country,
        arr.airport_code as to_airport_code,
        arr.airport_name as to_name,
        arr.city as to_city,
        arr.country as to_country
       FROM flights f
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       WHERE f.flight_number = ?`,
      [flightNumber]
    );

    if (!flights || flights.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Flight not found'
      });
    }

    res.json({
      success: true,
      data: { flight: flights[0] }
    });
  } catch (error) {
    console.error('Flight status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get flight status: ' + error.message
    });
  }
});

const seatHoldService = require('../services/seatHoldService');
const jwt = require('jsonwebtoken');
const { signingSecret } = require('../middleware/auth');

// ========== GET UNIFIED FLIGHT SEAT MAP ==========
router.get('/:id/seat-map', async (req, res) => {
  try {
    const flightId = parseInt(req.params.id, 10);
    if (isNaN(flightId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid flight ID' }
      });
    }

    // Optional user authentication to determine `mine: true/false`
    let currentUserId = null;
    const authHeader = req.headers.authorization;
    const token = req.cookies?.authToken || req.cookies?.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);

    if (token) {
      try {
        const decoded = jwt.verify(token, signingSecret);
        currentUserId = decoded.userId || decoded.id;
      } catch (err) {
        // Unauthenticated or expired token -> proceed with null currentUserId
      }
    }

    const seatMapData = await seatHoldService.getUnifiedSeatMap(flightId, currentUserId);
    res.json({
      success: true,
      data: seatMapData
    });
  } catch (error) {
    console.error('Seat map endpoint error:', error.message);
    const statusCode = error.status || 500;
    const errorCode = error.code || 'SEAT_MAP_FAILED';
    res.status(statusCode).json({
      success: false,
      error: { code: errorCode, message: error.message || 'Failed to fetch seat map' }
    });
  }
});

// ========== GET ALL AIRPORTS ==========
router.get('/airports', async (req, res) => {
  try {
    const airports = await query('SELECT airport_code, airport_name, city, country FROM airports ORDER BY city ASC');
    res.json({
      success: true,
      data: { airports: airports || [] }
    });
  } catch (error) {
    console.error('Get airports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve airports: ' + error.message
    });
  }
});

module.exports = router;
