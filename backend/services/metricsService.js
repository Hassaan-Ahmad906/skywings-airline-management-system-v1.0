const { queryOne } = require('../config/database');
const sql = require('./metricSql');
function numbers(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key,value]) => [key,Number(value || 0)]));
}
async function bookingStats(userId) {
  const row = await queryOne(`SELECT COUNT(*) AS totalBookings,
    COALESCE(SUM(${sql.confirmedBooking}),0) AS confirmedBookings,
    COALESCE(SUM(b.status = 'PENDING'),0) AS pendingBookings,
    COALESCE(SUM(b.status = 'CANCELLED'),0) AS cancelledBookings,
    COALESCE(SUM(${sql.upcomingBooking}),0) AS upcomingBookings,
    COALESCE(SUM(b.status = 'COMPLETED'),0) AS completedTrips,
    COALESCE(SUM(CASE WHEN ${sql.paidBooking} THEN b.total_amount ELSE 0 END),0) AS totalRevenue,
    COALESCE(SUM(CASE WHEN ${sql.paidBooking} AND MONTH(b.booking_date)=MONTH(CURRENT_DATE)
      AND YEAR(b.booking_date)=YEAR(CURRENT_DATE) THEN b.total_amount ELSE 0 END),0) AS monthlyRevenue,
    COALESCE(SUM(MONTH(b.booking_date)=MONTH(CURRENT_DATE) AND YEAR(b.booking_date)=YEAR(CURRENT_DATE)),0) AS monthlyBookings,
    COALESCE(SUM(CASE WHEN ${sql.paidBooking} AND MONTH(b.booking_date)=MONTH(DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH))
      AND YEAR(b.booking_date)=YEAR(DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH)) THEN b.total_amount ELSE 0 END),0) AS lastMonthRevenue,
    COALESCE(SUM(MONTH(b.booking_date)=MONTH(DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH))
      AND YEAR(b.booking_date)=YEAR(DATE_SUB(CURRENT_DATE,INTERVAL 1 MONTH))),0) AS lastMonthBookings
    FROM bookings b LEFT JOIN flights f ON f.flight_id=b.flight_id
    ${userId === undefined ? '' : 'WHERE b.user_id = ?'}`,userId === undefined ? [] : [userId]);
  return numbers(row);
}
async function flightStats() {
  return numbers(await queryOne(`SELECT COUNT(*) AS totalFlights,
    COALESCE(SUM(${sql.upcomingFlight}),0) AS upcomingFlights,
    COALESCE(SUM(f.status='scheduled'),0) AS scheduled,
    COALESCE(SUM(f.status='boarding'),0) AS boarding,
    COALESCE(SUM(f.status='in_air'),0) AS inAir,
    COALESCE(SUM(f.status='completed'),0) AS completed,
    COALESCE(SUM(f.status='delayed'),0) AS delayedFlights,
    COALESCE(SUM(f.status='cancelled'),0) AS cancelled,
    COALESCE(SUM(CASE WHEN f.status <> 'cancelled' THEN a.capacity ELSE 0 END),0) AS totalSeats,
    AVG(CASE WHEN f.status <> 'cancelled' THEN TIMESTAMPDIFF(MINUTE,f.departure_datetime,f.arrival_datetime) END) AS avgMinutes
    FROM flights f LEFT JOIN aircraft a ON a.aircraft_id=f.aircraft_id`));
}
async function performance() {
  const [flights,seats] = await Promise.all([flightStats(),queryOne(`SELECT COALESCE(SUM(b.number_of_passengers),0) AS booked
    FROM bookings b JOIN flights f ON f.flight_id=b.flight_id
    WHERE f.status <> 'cancelled' AND ${sql.confirmedBooking} AND ${sql.paidBooking}`)]);
  const booked = Number(seats?.booked || 0), minutes = Math.round(flights.avgMinutes);
  return {
    onTimePerformance: { rate:null, onTime:null, total:flights.totalFlights,
      scheduled:flights.scheduled, boarding:flights.boarding, inAir:flights.inAir,
      completed:flights.completed, delayed:flights.delayedFlights, cancelled:flights.cancelled },
    occupancy: { rate:flights.totalSeats ? Number((booked/flights.totalSeats*100).toFixed(2)) : 0, booked, total:flights.totalSeats },
    customerSatisfaction: { average:null, available:false, breakdown:{fiveStars:0,fourStars:0,threeStars:0} },
    efficiency: { avgFlightTime:`${Math.floor(minutes/60)}h ${minutes%60}m`, fuelEfficiency:null, maintenanceScore:null }
  };
}
async function adminStats() {
  const [bookings,flights,users,aircraft] = await Promise.all([bookingStats(),flightStats(),
    queryOne("SELECT COUNT(*) AS total FROM users WHERE role='user'"),
    queryOne("SELECT COUNT(*) AS total FROM aircraft WHERE status='active'")]);
  return { ...bookings,totalUsers:Number(users?.total || 0), totalFlights:flights.totalFlights,
    upcomingFlights:flights.upcomingFlights, activeFlights:flights.upcomingFlights,activeAircraft:Number(aircraft?.total || 0) };
}
async function customerStats(userId) {
  const stats = await bookingStats(userId);
  return { totalBookings:stats.totalBookings,upcomingFlights:stats.upcomingBookings,
    completedTrips:stats.completedTrips,totalSpent:stats.totalRevenue,loyalty:{available:false} };
}
module.exports = { bookingStats, flightStats, performance, adminStats, customerStats };
