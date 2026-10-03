const db = require('../config/database');
const stateMachine = require('./bookingStateMachine');
const ticketService = require('./ticketService');
function fail(message, status = 409) { throw Object.assign(new Error(message), { status, code: 'BOARDING_REJECTED' }); }
async function scan(token, flightId, actor) {
  if (!['admin','crew'].includes(actor.role)) fail('Gate authorization required', 403);
  if (!/^[a-f0-9]{64}$/.test(token || '') || !Number.isSafeInteger(flightId) || flightId < 1) fail('A valid boarding token and flight ID are required', 400);
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [flights] = await connection.execute('SELECT * FROM flights WHERE flight_id = ? FOR UPDATE', [flightId]);
    if (!flights.length) fail('Flight not found', 404);
    const flight = flights[0], minutes = (new Date(flight.departure_datetime) - new Date()) / 60000;
    if (actor.role === 'crew' && (!actor.gate_airport_code || actor.gate_airport_code !== flight.from_airport_code)) fail('This flight is outside your assigned airport', 403);
    if (['cancelled','completed','in_air'].includes(flight.status) || minutes <= 0 || minutes > 90) fail('Boarding is open only in the 90 minutes before departure');
    if (flight.boarding_open === 0) fail('Boarding is closed for this flight');
    const [tokens] = await connection.execute(`SELECT bp.*, b.status FROM booking_passengers bp JOIN bookings b ON b.booking_id = bp.booking_id
      WHERE bp.boarding_token = ? AND b.flight_id = ? FOR UPDATE`, [token, flightId]);
    if (!tokens.length) fail('Boarding pass does not match this flight', 404);
    const passenger = tokens[0];
    if (passenger.boarded_at) fail('This passenger has already boarded');
    if (passenger.status !== 'CHECKED_IN') fail('Booking must be checked in before boarding');
    await connection.execute('UPDATE booking_passengers SET boarded_at = NOW() WHERE booking_passenger_id = ?', [passenger.booking_passenger_id]);
    const [tickets] = await connection.execute("SELECT * FROM tickets WHERE booking_id = ? AND passenger_id = ? AND status = 'ISSUED' FOR UPDATE", [passenger.booking_id, passenger.passenger_id]);
    if (!tickets.length) fail('No valid issued ticket for this passenger');
    for (const ticket of tickets) await ticketService.updateTicketStatus(connection, ticket.ticket_id, 'ISSUED', 'USED', actor.userId, 'Passenger boarded at gate', { isCheckInFlow: true });
    const [remaining] = await connection.execute('SELECT COUNT(*) AS remaining FROM booking_passengers WHERE booking_id = ? AND boarded_at IS NULL', [passenger.booking_id]);
    if (Number(remaining[0].remaining) === 0) await stateMachine.transitionBookingState(connection, passenger.booking_id, 'BOARDED', { ...actor, type: actor.role === 'admin' ? 'ADMIN' : 'GATE_AGENT' }, 'All passengers boarded at gate');
    await connection.execute("INSERT INTO gate_audit_events (flight_id, booking_id, passenger_id, actor_user_id, action, outcome, reason) VALUES (?, ?, ?, ?, 'BOARDING_SCAN', 'accepted', 'Passenger identity checked and boarding recorded')", [flightId, passenger.booking_id, passenger.passenger_id, actor.userId || null]);
    await connection.commit();
    return { booking_id: passenger.booking_id, passenger_id: passenger.passenger_id, all_boarded: Number(remaining[0].remaining) === 0 };
  } catch (error) {
    await connection.rollback();
    try { await connection.execute("INSERT INTO gate_audit_events (flight_id, actor_user_id, action, outcome, reason) VALUES (?, ?, 'BOARDING_SCAN', 'rejected', ?)", [flightId, actor.userId || null, error.status ? error.message.slice(0,255) : 'Boarding could not be recorded']); }
    catch (auditError) { console.error('Rejected gate scan audit could not be saved:', auditError.code || 'AUDIT_FAILED'); }
    throw error;
  }
  finally { connection.release(); }
}
module.exports = { scan };
