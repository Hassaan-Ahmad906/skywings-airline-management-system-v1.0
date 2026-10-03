const db = require('../config/database');
const stateMachine = require('./bookingStateMachine');

// Scheduled work owns time-based transitions. GET requests never change state.
async function runSweep() {
  const [flights] = await db.pool.execute(`SELECT DISTINCT f.flight_id FROM flights f
    JOIN bookings b ON b.flight_id = f.flight_id
    WHERE (b.status = 'PENDING' AND (b.reservation_expires_at <= NOW() OR f.departure_datetime <= NOW()))
       OR (b.status IN ('CONFIRMED','CHECKED_IN') AND f.departure_datetime <= NOW())
       OR (b.status = 'BOARDED' AND f.status = 'completed')`);
  for (const flight of flights) {
    const connection = await db.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT flight_id FROM flights WHERE flight_id = ? FOR UPDATE', [flight.flight_id]);
      const [due] = await connection.execute(`SELECT b.booking_id, b.status,
        (b.reservation_expires_at <= NOW() OR f.departure_datetime <= NOW()) AS expired,
        f.departure_datetime <= NOW() AS departed, f.status AS flight_status
        FROM bookings b JOIN flights f ON f.flight_id = b.flight_id
        WHERE b.flight_id = ? AND b.status IN ('PENDING','CONFIRMED','CHECKED_IN','BOARDED') FOR UPDATE`, [flight.flight_id]);
      for (const booking of due) {
        const target = booking.status === 'PENDING' && booking.expired ? 'EXPIRED'
          : ['CONFIRMED','CHECKED_IN'].includes(booking.status) && booking.departed ? 'MISSED'
          : booking.status === 'BOARDED' && booking.flight_status === 'completed' ? 'COMPLETED' : null;
        if (target) await stateMachine.transitionBookingState(connection, booking.booking_id, target,
          { type: target === 'COMPLETED' ? 'SYSTEM' : 'CLEANER' },
          target === 'EXPIRED' ? 'Reservation payment deadline expired' : target === 'MISSED' ? 'No recorded boarding before departure' : 'Flight completed');
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
}
module.exports = { runSweep };
