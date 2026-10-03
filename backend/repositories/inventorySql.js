module.exports = `GREATEST(0, LEAST(
  a.capacity - COALESCE((SELECT SUM(b.number_of_passengers) FROM bookings b WHERE b.flight_id = f.flight_id
    AND (b.status IN ('CONFIRMED','CHECKED_IN','BOARDED') OR (b.status = 'PENDING' AND b.reservation_expires_at > NOW()))), 0)
    - (SELECT COUNT(*) FROM seat_holds h WHERE h.flight_id = f.flight_id AND h.status = 'HELD' AND h.expires_at > NOW() AND h.booking_id IS NULL),
  (SELECT COUNT(*) FROM seats s WHERE s.aircraft_id = f.aircraft_id AND s.seat_class = ? AND s.is_available = 1)
    - COALESCE((SELECT SUM(b.number_of_passengers) FROM bookings b WHERE b.flight_id = f.flight_id AND b.class = ?
      AND (b.status IN ('CONFIRMED','CHECKED_IN','BOARDED') OR (b.status = 'PENDING' AND b.reservation_expires_at > NOW()))), 0)
    - (SELECT COUNT(*) FROM seat_holds h JOIN seats s ON s.aircraft_id = f.aircraft_id AND s.seat_number = h.seat_number
      WHERE h.flight_id = f.flight_id AND h.status = 'HELD' AND h.expires_at > NOW() AND h.booking_id IS NULL AND s.seat_class = ?)
))`;
