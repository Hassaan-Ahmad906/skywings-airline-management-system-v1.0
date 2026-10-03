const { query } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const metrics = require('../services/metricsService');
const metricSql = require('../services/metricSql');
const router = require('../middleware/asyncRouter')();
router.use(authenticate);
router.use(requireAdmin);
const routeJoins = `FROM bookings b
  JOIN flights f ON b.flight_id=f.flight_id
  JOIN airports dep ON f.from_airport_code=dep.airport_code
  JOIN airports arr ON f.to_airport_code=arr.airport_code`;
const routeLabel = "CONCAT(dep.city, ' → ', arr.city)";
const growth = (current,previous) => previous > 0 ? Number(((current-previous)/previous*100).toFixed(1)) : null;
router.get('/overview', async (req,res) => {
  const [stats,performance,popularRoutes] = await Promise.all([metrics.bookingStats(),metrics.performance(),
    query(`SELECT ${routeLabel} AS route,COUNT(*) AS booking_count,SUM(b.total_amount) AS total_revenue
      ${routeJoins} WHERE ${metricSql.paidBooking}
      GROUP BY dep.airport_code,arr.airport_code,dep.city,arr.city ORDER BY booking_count DESC,route ASC LIMIT 5`)]);
  res.json({success:true,data:{revenue:{total:stats.totalRevenue,monthly:stats.monthlyRevenue},
    bookings:{total:stats.totalBookings,monthly:stats.monthlyBookings},popularRoutes,
    performance:{onTimeRate:performance.onTimePerformance.rate,occupancyRate:performance.occupancy.rate,customerSatisfaction:null}}});
});
router.get('/revenue', async (req,res) => {
  const [stats,revenueByRoute,revenueTrend] = await Promise.all([metrics.bookingStats(),
    query(`SELECT ${routeLabel} AS route,SUM(b.total_amount) AS revenue ${routeJoins}
      WHERE ${metricSql.paidBooking} GROUP BY dep.airport_code,arr.airport_code,dep.city,arr.city ORDER BY revenue DESC,route ASC LIMIT 5`),
    query(`SELECT DATE_FORMAT(b.booking_date,'%Y-%m') AS month,SUM(b.total_amount) AS revenue
      FROM bookings b WHERE ${metricSql.paidBooking} GROUP BY DATE_FORMAT(b.booking_date,'%Y-%m') ORDER BY month ASC`)]);
  res.json({success:true,data:{totalRevenue:stats.totalRevenue,monthlyRevenue:stats.monthlyRevenue,
    revenueByRoute,revenueTrend,growth:growth(stats.monthlyRevenue,stats.lastMonthRevenue)}});
});
router.get('/bookings', async (req,res) => {
  const [stats,bookingStatus,bookingTrend,bookingsByFlight] = await Promise.all([metrics.bookingStats(),
    query('SELECT status,COUNT(*) AS count FROM bookings GROUP BY status'),
    query(`SELECT DATE_FORMAT(booking_date,'%Y-%m') AS month,COUNT(*) AS count FROM bookings
      WHERE booking_date >= DATE_SUB(CURRENT_DATE,INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(booking_date,'%Y-%m') ORDER BY month ASC`),
    query(`SELECT f.flight_id,f.flight_number,dep.city AS from_city,arr.city AS to_city,
      f.departure_datetime,f.status AS flight_status,COUNT(*) AS total_bookings,
      SUM(${metricSql.confirmedBooking}) AS confirmed_bookings,SUM(b.status='CANCELLED') AS cancelled_bookings,
      SUM(CASE WHEN ${metricSql.paidBooking} THEN b.total_amount ELSE 0 END) AS total_revenue
      ${routeJoins} GROUP BY f.flight_id,f.flight_number,dep.city,arr.city,f.departure_datetime,f.status
      ORDER BY total_bookings DESC,f.flight_id ASC LIMIT 15`)]);
  res.json({success:true,data:{totalBookings:stats.totalBookings,monthlyBookings:stats.monthlyBookings,
    bookingStatus,bookingTrend,bookingsByFlight,growth:growth(stats.monthlyBookings,stats.lastMonthBookings)}});
});
router.get('/routes', async (req,res) => {
  const [popularRoutes,routePerformance,routeRevenue] = await Promise.all([
    query(`SELECT ${routeLabel} AS route,dep.airport_code AS from_code,arr.airport_code AS to_code,
      COUNT(*) AS booking_count,SUM(b.total_amount) AS revenue ${routeJoins} WHERE ${metricSql.paidBooking}
      GROUP BY dep.city,arr.city,dep.airport_code,arr.airport_code ORDER BY booking_count DESC,route ASC LIMIT 10`),
    query(`SELECT ${routeLabel} AS route,SUM(b.total_amount)/NULLIF(SUM(b.number_of_passengers),0) AS avg_price
      ${routeJoins} WHERE ${metricSql.paidBooking} GROUP BY dep.airport_code,arr.airport_code,dep.city,arr.city ORDER BY avg_price DESC,route ASC LIMIT 10`),
    query(`SELECT ${routeLabel} AS route,SUM(b.total_amount) AS revenue ${routeJoins} WHERE ${metricSql.paidBooking}
      GROUP BY dep.airport_code,arr.airport_code,dep.city,arr.city ORDER BY revenue DESC,route ASC LIMIT 10`)]);
  res.json({success:true,data:{popularRoutes,routePerformance,routeRevenue}});
});
router.get('/performance', async (req,res) => {
  res.json({success:true,data:await metrics.performance()});
});
module.exports = router;
