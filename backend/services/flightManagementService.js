const db = require('../config/database');
const stateMachine = require('./bookingStateMachine');
const fields = ['flight_number', 'aircraft_id', 'from_airport_code', 'to_airport_code',
  'departure_datetime', 'arrival_datetime', 'base_price', 'business_price', 'first_class_price', 'status'];

function invalid(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function validateFlight(flight) {
  if (!/^[A-Z0-9-]{2,10}$/.test(flight.flight_number || '')) invalid('Flight number must contain 2–10 uppercase letters, digits or hyphens');
  if (!Number.isSafeInteger(Number(flight.aircraft_id)) || Number(flight.aircraft_id) < 1) invalid('Invalid aircraft');
  if (![flight.from_airport_code, flight.to_airport_code].every(code => /^[A-Z]{3}$/.test(code || '')) || flight.from_airport_code === flight.to_airport_code) invalid('Choose different valid origin and destination airports');
  const departure = new Date(flight.departure_datetime), arrival = new Date(flight.arrival_datetime);
  if (!Number.isFinite(departure.getTime()) || !Number.isFinite(arrival.getTime()) || arrival <= departure) invalid('Arrival must be after departure');
  for (const field of ['base_price','business_price','first_class_price']) if (flight[field] === null || flight[field] === '' || !Number.isFinite(Number(flight[field])) || Number(flight[field]) < 0 || Number(flight[field]) > 1000000) invalid('All fares must be finite, nonnegative amounts');
  if (!['scheduled','delayed','cancelled','completed','boarding','in_air'].includes(flight.status)) invalid('Invalid flight status');
  return { ...flight, aircraft_id: Number(flight.aircraft_id), departure_datetime: departure, arrival_datetime: arrival };
}
async function validateReferences(connection, flight, flightId = 0) {
  if (flight.status === 'cancelled') return;
  const [aircraft] = await connection.execute('SELECT status FROM aircraft WHERE aircraft_id = ? FOR UPDATE', [flight.aircraft_id]);
  if (!aircraft.length || aircraft[0].status !== 'active') invalid('Select an active aircraft');
  const [airports] = await connection.execute('SELECT airport_code FROM airports WHERE airport_code IN (?, ?)', [flight.from_airport_code, flight.to_airport_code]);
  if (airports.length !== 2) invalid('Origin or destination airport does not exist');
  if (flight.status !== 'cancelled') {
    const [conflicts] = await connection.execute(`SELECT flight_id FROM flights WHERE aircraft_id = ? AND flight_id <> ? AND status <> 'cancelled'
      AND departure_datetime < DATE_ADD(?, INTERVAL 30 MINUTE) AND arrival_datetime > DATE_SUB(?, INTERVAL 30 MINUTE) LIMIT 1`,
      [flight.aircraft_id, flightId, flight.arrival_datetime, flight.departure_datetime]);
    if (conflicts.length) invalid('Aircraft has an overlapping flight or insufficient turnaround time', 409);
  }
}

async function updateFlight(flightId, changes, actor) {
  if (!Number.isSafeInteger(flightId) || flightId < 1) throw Object.assign(new Error('Invalid flight ID'), { status: 400 });
  const updates = fields.filter(field => changes[field] !== undefined);
  if (!updates.length) throw Object.assign(new Error('No fields to update'), { status: 400 });
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM flights WHERE flight_id = ? FOR UPDATE', [flightId]);
    if (!rows.length) throw Object.assign(new Error('Flight not found'), { status: 404 });
    const merged = validateFlight({ ...rows[0], ...Object.fromEntries(updates.map(field => [field, changes[field]])) });
    const itineraryFields = ['aircraft_id','from_airport_code','to_airport_code','departure_datetime','arrival_datetime'];
    const itineraryChanged = itineraryFields.some(field => updates.includes(field) && (field.endsWith('datetime')
      ? new Date(rows[0][field]).getTime() !== merged[field].getTime() : String(rows[0][field]) !== String(merged[field])));
    if (itineraryChanged) {
      const [booked] = await connection.execute("SELECT booking_id FROM bookings WHERE flight_id = ? AND status IN ('PENDING','CONFIRMED','CHECKED_IN','BOARDED') LIMIT 1", [flightId]);
      const [holds] = await connection.execute("SELECT hold_id FROM seat_holds WHERE flight_id = ? AND status = 'HELD' AND expires_at > NOW() LIMIT 1", [flightId]);
      if (booked.length || holds.length) invalid('Use flight disruption and rebooking actions to change an itinerary with active bookings or holds', 409);
    }
    await validateReferences(connection, merged, flightId);
    await connection.execute(`UPDATE flights SET ${updates.map(field => `${field} = ?`).join(', ')} WHERE flight_id = ?`, [...updates.map(field => merged[field]), flightId]);
    if (changes.status === 'cancelled') {
      const [bookings] = await connection.execute("SELECT booking_id FROM bookings WHERE flight_id = ? AND status IN ('PENDING','CONFIRMED','CHECKED_IN','BOARDED') ORDER BY booking_id FOR UPDATE", [flightId]);
      for (const booking of bookings) await stateMachine.transitionBookingState(connection, booking.booking_id, 'CANCELLED',
        { ...actor, type: 'ADMIN' }, 'Flight cancelled by airline', { allowOverride: true });
      await connection.execute("UPDATE seat_holds SET status = 'RELEASED', released_at = NOW() WHERE flight_id = ? AND status = 'HELD'", [flightId]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
async function createFlight(changes) {
  const flight = validateFlight({ ...changes, business_price: changes.business_price ?? Number(changes.base_price) * 1.5,
    first_class_price: changes.first_class_price ?? Number(changes.base_price) * 2, status: changes.status ?? 'scheduled' });
  if (flight.departure_datetime <= new Date()) invalid('New flights must depart in the future');
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    await validateReferences(connection, flight);
    const [result] = await connection.execute(`INSERT INTO flights (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map(field => flight[field]));
    await connection.commit(); return result.insertId;
  } catch (error) { await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') invalid('Flight number already exists', 409); throw error; }
  finally { connection.release(); }
}
module.exports = { updateFlight, createFlight, validateFlight, validateReferences };
