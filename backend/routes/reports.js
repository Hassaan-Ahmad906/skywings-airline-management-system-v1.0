const express = require('express');
const { query, queryOne } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = require('../middleware/asyncRouter')();

// All report routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// ========== OVERVIEW STATISTICS ==========
router.get('/overview', async (req, res) => {
  try {

    // Total revenue (exact match with admin stats)
    const totalRevenue = await queryOne(
      `SELECT COALESCE(SUM(total_amount), 0) as total 
       FROM bookings 
       WHERE LOWER(status) IN ('confirmed', 'checked_in', 'boarded', 'completed') AND payment_status = 'paid'`
    );

    // Monthly revenue (current month)
    const monthlyRevenue = await queryOne(
      `SELECT COALESCE(SUM(total_amount), 0) as total 
       FROM bookings 
       WHERE LOWER(status) IN ('confirmed', 'checked_in', 'boarded', 'completed')
         AND payment_status = 'paid'
         AND MONTH(booking_date) = MONTH(CURRENT_DATE)
         AND YEAR(booking_date) = YEAR(CURRENT_DATE)`
    );

    // Total bookings (all time)
    const totalBookings = await queryOne(
      'SELECT COUNT(*) as total FROM bookings'
    );

    // Monthly bookings (current month)
    const monthlyBookings = await queryOne(
      `SELECT COUNT(*) as total 
       FROM bookings 
       WHERE MONTH(booking_date) = MONTH(CURRENT_DATE)
         AND YEAR(booking_date) = YEAR(CURRENT_DATE)`
    );

    // Popular routes (top 5)
    const popularRoutes = await query(
      `SELECT 
        CONCAT(dep.city, ' → ', arr.city) as route,
        COUNT(*) as booking_count,
        COALESCE(SUM(b.total_amount), 0) as total_revenue
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed') AND b.payment_status = 'paid'
       GROUP BY dep.city, arr.city
       ORDER BY booking_count DESC
       LIMIT 5`
    );

    // Flight performance
    const onTimeFlights = await queryOne(
      `SELECT COUNT(*) as total 
       FROM flights 
       WHERE LOWER(status) IN ('scheduled', 'boarding', 'completed')`
    );

    const delayedFlights = await queryOne(
      `SELECT COUNT(*) as total 
       FROM flights 
       WHERE LOWER(status) = 'delayed'`
    );

    const totalFlights = (onTimeFlights?.total || 0) + (delayedFlights?.total || 0);
    const onTimeRate = null; // Actual departure timestamps are not recorded.

    // Occupancy rate
    const totalSeats = await queryOne(
      `SELECT COALESCE(SUM(a.capacity), 0) as total 
       FROM flights f
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id WHERE f.status <> 'cancelled'`
    );

    const bookedSeats = await queryOne(
      `SELECT COUNT(*) as total 
       FROM booking_passengers bp
       INNER JOIN bookings b ON bp.booking_id = b.booking_id
       INNER JOIN flights f ON f.flight_id = b.flight_id
       WHERE f.status <> 'cancelled' AND b.status IN ('CONFIRMED','CHECKED_IN','BOARDED','COMPLETED')`
    );

    const occupancyRate = (totalSeats?.total || 0) > 0
      ? Math.min(100, Math.round(((bookedSeats?.total || 0) / (totalSeats?.total || 0)) * 100))
      : 0;

    res.json({
      success: true,
      data: {
        revenue: {
          total: parseFloat(totalRevenue?.total || 0),
          monthly: parseFloat(monthlyRevenue?.total || 0)
        },
        bookings: {
          total: totalBookings?.total || 0,
          monthly: monthlyBookings?.total || 0
        },
        popularRoutes: popularRoutes || [],
        performance: {
          onTimeRate,
          occupancyRate,
          customerSatisfaction: null
        }
      }
    });
  } catch (error) {
    console.error('Get overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get overview: ' + error.message
    });
  }
});

// ========== REVENUE REPORTS ==========
router.get('/revenue', async (req, res) => {
  try {

    // Total revenue (exact match with admin stats and overview)
    const totalRevenue = await queryOne(
      `SELECT COALESCE(SUM(total_amount), 0) as total 
       FROM bookings 
       WHERE LOWER(status) IN ('confirmed', 'checked_in', 'boarded', 'completed') AND payment_status = 'paid'`
    );

    // Monthly revenue
    const monthlyRevenue = await queryOne(
      `SELECT COALESCE(SUM(total_amount), 0) as total 
       FROM bookings 
       WHERE LOWER(status) IN ('confirmed', 'checked_in', 'boarded', 'completed') 
         AND payment_status = 'paid'
         AND MONTH(booking_date) = MONTH(CURRENT_DATE)
         AND YEAR(booking_date) = YEAR(CURRENT_DATE)`
    );

    // Revenue by route (top routes)
    const revenueByRoute = await query(
      `SELECT 
        CONCAT(dep.city, ' → ', arr.city) as route,
        COALESCE(SUM(b.total_amount), 0) as revenue
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed') AND b.payment_status = 'paid'
       GROUP BY dep.city, arr.city
       ORDER BY revenue DESC
       LIMIT 5`
    );

    // Revenue trend (all available months)
    const revenueTrend = await query(
      `SELECT 
        DATE_FORMAT(booking_date, '%Y-%m') as month,
        COALESCE(SUM(total_amount), 0) as revenue
       FROM bookings
       WHERE LOWER(status) IN ('confirmed', 'checked_in', 'boarded', 'completed') 
         AND payment_status = 'paid'
       GROUP BY DATE_FORMAT(booking_date, '%Y-%m')
       ORDER BY month ASC`
    );

    const currentMonthRevenue = parseFloat(monthlyRevenue?.total || 0);
    const lastMonthRevenue = await queryOne(
      `SELECT COALESCE(SUM(total_amount), 0) as total 
       FROM bookings 
       WHERE LOWER(status) IN ('confirmed', 'checked_in', 'boarded', 'completed') 
         AND payment_status = 'paid'
         AND MONTH(booking_date) = MONTH(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH))
         AND YEAR(booking_date) = YEAR(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH))`
    );

    const lastMonth = parseFloat(lastMonthRevenue?.total || 0);
    const growth = lastMonth > 0 
      ? (((currentMonthRevenue - lastMonth) / lastMonth) * 100).toFixed(1)
      : null;

    res.json({
      success: true,
      data: {
        totalRevenue: parseFloat(totalRevenue?.total || 0),
        monthlyRevenue: currentMonthRevenue,
        revenueByRoute: revenueByRoute || [],
        revenueTrend: revenueTrend || [],
        growth: growth === null ? null : parseFloat(growth)
      }
    });
  } catch (error) {
    console.error('Get revenue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get revenue: ' + error.message
    });
  }
});

// ========== BOOKINGS REPORTS ==========
router.get('/bookings', async (req, res) => {
  try {
    // Total bookings
    const totalBookings = await queryOne(
      'SELECT COUNT(*) as total FROM bookings'
    );

    // Monthly bookings
    const monthlyBookings = await queryOne(
      `SELECT COUNT(*) as total 
       FROM bookings 
       WHERE MONTH(booking_date) = MONTH(CURRENT_DATE)
         AND YEAR(booking_date) = YEAR(CURRENT_DATE)`
    );

    // Booking status breakdown
    const bookingStatus = await query(
      `SELECT 
        status,
        COUNT(*) as count
       FROM bookings
       GROUP BY status`
    );

    // Booking trend (last 6 months)
    const bookingTrend = await query(
      `SELECT 
        DATE_FORMAT(booking_date, '%Y-%m') as month,
        COUNT(*) as count
       FROM bookings
       WHERE booking_date >= DATE_SUB(CURRENT_DATE, INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(booking_date, '%Y-%m')
       ORDER BY month ASC`
    );

    // Calculate growth
    const currentMonth = monthlyBookings?.total || 0;
    const lastMonthBookings = await queryOne(
      `SELECT COUNT(*) as total 
       FROM bookings 
       WHERE MONTH(booking_date) = MONTH(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH))
         AND YEAR(booking_date) = YEAR(DATE_SUB(CURRENT_DATE, INTERVAL 1 MONTH))`
    );

    const lastMonth = lastMonthBookings?.total || 0;
    const growth = lastMonth > 0 
      ? (((currentMonth - lastMonth) / lastMonth) * 100).toFixed(1)
      : '0.0';

    // Bookings Grouped by Flight Number
    const bookingsByFlight = await query(
      `SELECT 
        f.flight_id,
        f.flight_number,
        dep.city as from_city,
        arr.city as to_city,
        f.departure_datetime,
        f.status as flight_status,
        COUNT(b.booking_id) as total_bookings,
        SUM(CASE WHEN LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed') THEN 1 ELSE 0 END) as confirmed_bookings,
        SUM(CASE WHEN LOWER(b.status) = 'cancelled' THEN 1 ELSE 0 END) as cancelled_bookings,
        COALESCE(SUM(CASE WHEN LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed') AND b.payment_status = 'paid' THEN b.total_amount ELSE 0 END), 0) as total_revenue
       FROM flights f
       LEFT JOIN bookings b ON f.flight_id = b.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       GROUP BY f.flight_id, f.flight_number, dep.city, arr.city, f.departure_datetime, f.status
       HAVING total_bookings > 0
       ORDER BY total_bookings DESC
       LIMIT 15`
    );

    res.json({
      success: true,
      data: {
        totalBookings: totalBookings?.total || 0,
        monthlyBookings: currentMonth,
        bookingStatus: bookingStatus || [],
        bookingTrend: bookingTrend || [],
        bookingsByFlight: bookingsByFlight || [],
        growth: parseFloat(growth)
      }
    });
  } catch (error) {
    console.error('Get bookings report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bookings report: ' + error.message
    });
  }
});

// ========== ROUTES REPORTS ==========
router.get('/routes', async (req, res) => {
  try {
    // Popular routes (by booking count)
    const popularRoutes = await query(
      `SELECT 
        CONCAT(dep.city, ' → ', arr.city) as route,
        dep.airport_code as from_code,
        arr.airport_code as to_code,
        COUNT(*) as booking_count
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed')
       GROUP BY dep.city, arr.city, dep.airport_code, arr.airport_code
       ORDER BY booking_count DESC
       LIMIT 10`
    );

    // Route performance (average price)
    const routePerformance = await query(
      `SELECT 
        CONCAT(dep.city, ' → ', arr.city) as route,
        AVG(
          CASE 
            WHEN b.class = 'economy' THEN f.base_price
            WHEN b.class = 'business' THEN f.business_price
            WHEN b.class = 'first' THEN f.first_class_price
            ELSE f.base_price
          END
        ) as avg_price
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed')
       GROUP BY dep.city, arr.city
       ORDER BY avg_price DESC
       LIMIT 10`
    );

    // Route revenue
    const routeRevenue = await query(
      `SELECT 
        CONCAT(dep.city, ' → ', arr.city) as route,
        COALESCE(SUM(b.total_amount), 0) as revenue
       FROM bookings b
       INNER JOIN flights f ON b.flight_id = f.flight_id
       INNER JOIN airports dep ON f.from_airport_code = dep.airport_code
       INNER JOIN airports arr ON f.to_airport_code = arr.airport_code
       WHERE LOWER(b.status) IN ('confirmed', 'checked_in', 'boarded', 'completed') AND b.payment_status = 'paid'
       GROUP BY dep.city, arr.city
       ORDER BY revenue DESC
       LIMIT 10`
    );

    res.json({
      success: true,
      data: {
        popularRoutes: popularRoutes || [],
        routePerformance: routePerformance || [],
        routeRevenue: routeRevenue || []
      }
    });
  } catch (error) {
    console.error('Get routes report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get routes report: ' + error.message
    });
  }
});

// ========== PERFORMANCE REPORTS ==========
router.get('/performance', async (req, res) => {
  try {
    // On-time performance
    const onTimeFlights = await queryOne(
      `SELECT COUNT(*) as total 
       FROM flights 
       WHERE LOWER(status) IN ('scheduled', 'boarding', 'completed')`
    );

    const delayedFlights = await queryOne(
      `SELECT COUNT(*) as total 
       FROM flights 
       WHERE LOWER(status) = 'delayed'`
    );

    const cancelledFlights = await queryOne(
      `SELECT COUNT(*) as total 
       FROM flights 
       WHERE LOWER(status) = 'cancelled'`
    );

    const totalFlights = (onTimeFlights?.total || 0) + (delayedFlights?.total || 0) + (cancelledFlights?.total || 0);
    const onTimeRate = null; // Actual departure timestamps are not recorded.

    // Occupancy rate
    const totalSeats = await queryOne(
      `SELECT COALESCE(SUM(a.capacity), 0) as total 
       FROM flights f
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       WHERE f.status <> 'cancelled'`
    );

    const bookedSeats = await queryOne(
      `SELECT COUNT(*) as total 
       FROM booking_passengers bp
       INNER JOIN bookings b ON bp.booking_id = b.booking_id
       WHERE LOWER(b.status) NOT IN ('cancelled', 'expired')`
    );

    const occupancyRate = (totalSeats?.total || 0) > 0
      ? Math.round(((bookedSeats?.total || 0) / (totalSeats?.total || 0)) * 100)
      : 0;

    // Average flight time
    const avgFlightTime = await queryOne(
      `SELECT 
        AVG(TIMESTAMPDIFF(MINUTE, departure_datetime, arrival_datetime)) as avg_minutes
       FROM flights
       WHERE status IN ('completed', 'scheduled', 'boarding')`
    );

    const avgMinutes = avgFlightTime?.avg_minutes || 0;
    const hours = Math.floor(avgMinutes / 60);
    const minutes = Math.round(avgMinutes % 60);

    res.json({
      success: true,
      data: {
        onTimePerformance: {
          rate: onTimeRate,
          onTime: onTimeFlights?.total || 0,
          delayed: delayedFlights?.total || 0,
          cancelled: cancelledFlights?.total || 0,
          total: totalFlights
        },
        occupancy: {
          rate: occupancyRate,
          booked: bookedSeats?.total || 0,
          total: totalSeats?.total || 0
        },
        customerSatisfaction: {
          average: null, available: false,
          breakdown: {
            fiveStars: 0,
            fourStars: 0,
            threeStars: 0
          }
        },
        efficiency: {
          avgFlightTime: `${hours}h ${minutes}m`,
          fuelEfficiency: null,
          maintenanceScore: null
        }
      }
    });
  } catch (error) {
    console.error('Get performance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get performance: ' + error.message
    });
  }
});

module.exports = router;

