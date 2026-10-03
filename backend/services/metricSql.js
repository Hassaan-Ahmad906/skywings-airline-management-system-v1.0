// Shared definitions for dashboards, reports and list classifications.
const confirmedBooking = "b.status IN ('CONFIRMED','CHECKED_IN','BOARDED','COMPLETED')";
const paidBooking = "b.payment_status = 'paid'";
const upcomingFlight = "f.departure_datetime > CURRENT_TIMESTAMP AND f.status IN ('scheduled','boarding','delayed') AND a.status = 'active'";
const upcomingBooking = `f.departure_datetime > CURRENT_TIMESTAMP
  AND f.status IN ('scheduled','boarding','delayed')
  AND (b.status IN ('CONFIRMED','CHECKED_IN','BOARDED')
    OR (b.status = 'PENDING' AND b.reservation_expires_at > CURRENT_TIMESTAMP))`;
module.exports = { confirmedBooking, paidBooking, upcomingFlight, upcomingBooking };
