const express = require('express');
const { query } = require('../config/database');

const router = express.Router();

// ========== SEARCH FLIGHTS ==========
router.get('/search', async (req, res) => {
  try {
    const { from, to, departure, return: returnDate, passengers = 1, class: flightClass = 'economy' } = req.query;

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
        COALESCE(a.model, 'Standard Jet') as aircraft_model,
        COALESCE(a.capacity, 180) as capacity,
        COALESCE(dep.airport_code, f.from_airport_code) as from_code,
        COALESCE(dep.airport_name, f.from_airport_code) as from_name,
        COALESCE(dep.city, f.from_airport_code) as from_city,
        COALESCE(dep.country, '') as from_country,
        COALESCE(arr.airport_code, f.to_airport_code) as to_code,
        COALESCE(arr.airport_name, f.to_airport_code) as to_name,
        COALESCE(arr.city, f.to_airport_code) as to_city,
        COALESCE(arr.country, '') as to_country,
        CASE 
          WHEN ? = 'economy' THEN f.base_price
          WHEN ? = 'business' THEN f.business_price
          WHEN ? = 'first' THEN f.first_class_price
          ELSE f.base_price
        END as price,
        GREATEST(
          0,
          COALESCE(a.capacity, 150) - GREATEST(
            COALESCE((SELECT SUM(b.number_of_passengers) FROM bookings b WHERE b.flight_id = f.flight_id AND b.status IN ('CONFIRMED', 'CHECKED_IN', 'BOARDED', 'PENDING')), 0),
            COALESCE((SELECT COUNT(*) FROM flight_seat_allocations fsa WHERE fsa.flight_id = f.flight_id), 0)
          )
        ) as available_seats
      FROM flights f
      LEFT JOIN airports dep ON f.from_airport_code = dep.airport_code
      LEFT JOIN airports arr ON f.to_airport_code = arr.airport_code
      LEFT JOIN aircraft a ON f.aircraft_id = a.aircraft_id
      WHERE f.status IN ('scheduled', 'boarding')
        AND f.departure_datetime > CURRENT_TIMESTAMP
    `;

    const params = [flightClass, flightClass, flightClass];

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

    sql += ' ORDER BY f.departure_datetime ASC';

    const flights = await query(sql, params);

    for (let flight of flights) {
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
    const airports = await query('SELECT airport_code, airport_name, city, country FROM airports ORDER BY city ASC');
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
        COALESCE(a.model, 'Standard Jet') as aircraft_model,
        COALESCE(a.capacity, 180) as capacity,
        COALESCE(dep.airport_code, f.from_airport_code) as from_code,
        COALESCE(dep.airport_name, f.from_airport_code) as from_name,
        COALESCE(dep.city, f.from_airport_code) as from_city,
        COALESCE(dep.country, '') as from_country,
        COALESCE(arr.airport_code, f.to_airport_code) as to_code,
        COALESCE(arr.airport_name, f.to_airport_code) as to_name,
        COALESCE(arr.city, f.to_airport_code) as to_city,
        COALESCE(arr.country, '') as to_country
       FROM flights f
       LEFT JOIN airports dep ON f.from_airport_code = dep.airport_code
       LEFT JOIN airports arr ON f.to_airport_code = arr.airport_code
       LEFT JOIN aircraft a ON f.aircraft_id = a.aircraft_id
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
        COALESCE(a.model, 'Standard Jet') as aircraft_model,
        COALESCE(dep.airport_code, f.from_airport_code) as from_airport_code,
        COALESCE(dep.airport_name, f.from_airport_code) as from_name,
        COALESCE(dep.city, f.from_airport_code) as from_city,
        COALESCE(dep.country, '') as from_country,
        COALESCE(arr.airport_code, f.to_airport_code) as to_airport_code,
        COALESCE(arr.airport_name, f.to_airport_code) as to_name,
        COALESCE(arr.city, f.to_airport_code) as to_city,
        COALESCE(arr.country, '') as to_country
       FROM flights f
       LEFT JOIN airports dep ON f.from_airport_code = dep.airport_code
       LEFT JOIN airports arr ON f.to_airport_code = arr.airport_code
       LEFT JOIN aircraft a ON f.aircraft_id = a.aircraft_id
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
