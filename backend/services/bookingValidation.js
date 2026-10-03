function invalid(message) {
  const error = new Error(message); error.status = 400; error.code = 'INVALID_INPUT'; throw error;
}
function validateBooking(data) {
  if (!data || typeof data !== 'object') invalid('Booking data is required.');
  if (!Number.isSafeInteger(Number(data.flight_id)) || Number(data.flight_id) < 1) invalid('Valid flight ID is required.');
  const cabin = data.class || data.flight_class || 'economy';
  if (typeof cabin !== 'string' || !['economy', 'business', 'first'].includes(cabin.toLowerCase())) invalid('Invalid cabin class.');
  if (!Array.isArray(data.passengers) || data.passengers.length < 1 || data.passengers.length > 9) invalid('Bookings require between 1 and 9 passengers.');
  const ids = new Set();
  for (const passenger of data.passengers) {
    if (!passenger || typeof passenger !== 'object') invalid('Passenger details are required.');
    if (passenger.passenger_id != null) {
      const id = Number(passenger.passenger_id);
      if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) invalid('Invalid or duplicate saved passenger.');
      ids.add(id);
    } else {
      for (const key of ['first_name', 'last_name']) {
        if (typeof passenger[key] !== 'string' || !/^[\p{L}\p{M}][\p{L}\p{M}\s'-]{0,99}$/u.test(passenger[key].trim())) invalid('Passenger names must contain letters and be at most 100 characters.');
        passenger[key] = passenger[key].trim();
      }
      if (passenger.date_of_birth) {
        const date = new Date(passenger.date_of_birth);
        if (typeof passenger.date_of_birth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(passenger.date_of_birth) ||
          !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== passenger.date_of_birth || date > new Date()) invalid('Invalid passenger date of birth.');
      }
      for (const [key, max] of [['passport_number', 50], ['nationality', 100]]) {
        if (passenger[key] != null && (typeof passenger[key] !== 'string' || passenger[key].length > max || /[<>]/.test(passenger[key]))) invalid(`Invalid ${key.replaceAll('_', ' ')}.`);
      }
    }
    if (passenger.seat_number != null && (typeof passenger.seat_number !== 'string' || !/^\d{1,3}[A-Z]$/i.test(passenger.seat_number.trim()))) invalid('Invalid seat number.');
  }
  for (const key of ['idempotency_key', 'session_id']) {
    if (data[key] != null && (typeof data[key] !== 'string' || !data[key] || data[key].length > 100)) invalid(`Invalid ${key}.`);
  }
  return cabin.toLowerCase();
}
module.exports = { validateBooking };
