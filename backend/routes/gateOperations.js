const router = require('../middleware/asyncRouter')();
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function authorizedFlight(user, id, connection = db.pool, lock = false) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) fail('Invalid flight');
  const [[flight]] = await connection.execute('SELECT * FROM flights WHERE flight_id = ?' + (lock ? ' FOR UPDATE' : ''), [Number(id)]);
  if (!flight) fail('Flight not found', 404);
  if (user.role === 'crew' && user.gate_airport_code !== flight.from_airport_code) fail('Flight is outside your assigned airport', 403);
  return flight;
}
router.get('/flights', async (req, res) => {
  const params = [], scope = req.user.role === 'crew' ? ' AND f.from_airport_code = ?' : '';
  if (scope) params.push(req.user.gate_airport_code);
  const [flights] = await db.pool.execute(`SELECT f.flight_id, f.flight_number, f.from_airport_code, f.to_airport_code,
    f.departure_datetime, f.arrival_datetime, f.status, f.gate_number, f.boarding_open,
    (SELECT COUNT(*) FROM booking_passengers bp JOIN bookings b ON b.booking_id = bp.booking_id WHERE b.flight_id = f.flight_id AND b.status IN ('CONFIRMED','CHECKED_IN','BOARDED')) AS expected,
    (SELECT COUNT(*) FROM booking_passengers bp JOIN bookings b ON b.booking_id = bp.booking_id WHERE b.flight_id = f.flight_id AND bp.boarded_at IS NOT NULL AND b.status IN ('CHECKED_IN','BOARDED')) AS boarded
    FROM flights f WHERE departure_datetime BETWEEN DATE_SUB(NOW(), INTERVAL 12 HOUR) AND DATE_ADD(NOW(), INTERVAL 72 HOUR)
    AND f.status IN ('scheduled','delayed','boarding','in_air','completed') ${scope} ORDER BY departure_datetime LIMIT 200`, params);
  res.json({ success: true, data: { flights, airport: req.user.gate_airport_code || 'All airports', role: req.user.role } });
});
router.get('/flights/:id/manifest', async (req, res) => {
  const flight = await authorizedFlight(req.user, req.params.id);
  const [passengers] = await db.pool.execute(`SELECT bp.passenger_id, bp.booking_id, b.booking_reference, p.first_name, p.last_name,
    bp.seat_number, bp.boarded_at, b.status, b.class FROM booking_passengers bp
    JOIN bookings b ON b.booking_id = bp.booking_id JOIN passengers p ON p.passenger_id = bp.passenger_id
    WHERE b.flight_id = ? AND b.status IN ('CONFIRMED','CHECKED_IN','BOARDED','MISSED','COMPLETED')
    ORDER BY bp.boarded_at IS NOT NULL, p.last_name, p.first_name`, [flight.flight_id]);
  res.json({ success: true, data: { flight, passengers } });
});
router.get('/flights/:id/audit', async (req, res) => {
  const flight = await authorizedFlight(req.user, req.params.id);
  const [events] = await db.pool.execute(`SELECT e.event_id, e.created_at, e.action, e.outcome, e.reason, e.passenger_id, e.booking_id,
    CONCAT(u.first_name, ' ', u.last_name) AS actor_name FROM gate_audit_events e LEFT JOIN users u ON u.user_id = e.actor_user_id
    WHERE e.flight_id = ? ORDER BY e.event_id DESC LIMIT 100`, [flight.flight_id]);
  res.json({ success: true, data: { events } });
});
router.patch('/flights/:id/gate', async (req, res) => {
  const { action, gate_number: gate } = req.body;
  if (!['open','close','assign'].includes(action) || (action === 'assign' && !/^[A-Z0-9-]{1,10}$/.test(gate || ''))) fail('Choose a valid gate action and gate number');
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const flight = await authorizedFlight(req.user, req.params.id, connection, true);
    const minutes = (new Date(flight.departure_datetime) - Date.now()) / 60000;
    if (action !== 'close' && ['cancelled','completed','in_air'].includes(flight.status)) fail('Gate operations are closed for this flight', 409);
    if (action === 'open' && (minutes <= 0 || minutes > 90)) fail('Boarding can open only in the 90 minutes before departure', 409);
    if (action === 'assign') {
      await connection.execute('UPDATE flights SET gate_number = ? WHERE flight_id = ?', [gate, flight.flight_id]);
      await connection.execute("UPDATE check_ins ci JOIN bookings b ON b.booking_id = ci.booking_id SET ci.gate_number = ? WHERE b.flight_id = ? AND ci.status = 'completed'", [gate, flight.flight_id]);
    } else await connection.execute('UPDATE flights SET boarding_open = ? WHERE flight_id = ?', [action === 'open' ? 1 : 0, flight.flight_id]);
    await connection.execute("INSERT INTO gate_audit_events (flight_id, actor_user_id, action, outcome, reason) VALUES (?, ?, ?, 'accepted', ?)", [flight.flight_id, req.user.userId, 'GATE_' + action.toUpperCase(), action === 'assign' ? 'Gate assigned: ' + gate : 'Boarding ' + (action === 'open' ? 'opened' : 'closed')]);
    await connection.commit(); res.json({ success: true, message: 'Gate updated' });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
});
router.post('/staff', requireAdmin, async (req, res) => {
  const { first_name: first, last_name: last, email, password, airport } = req.body;
  if (![first,last].every(name => typeof name === 'string' && /^[\p{L}\p{M}][\p{L}\p{M} '-]{0,99}$/u.test(name)) ||
    typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' || password.length < 12 || password.length > 72 || !/^[A-Z]{3}$/.test(airport || '')) fail('Provide staff names, valid email, airport and a password of 12–72 characters');
  const [[exists]] = await db.pool.execute('SELECT airport_code FROM airports WHERE airport_code = ?', [airport]);
  if (!exists) fail('Airport not found');
  const hash = await require('bcryptjs').hash(password, 12);
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute("INSERT INTO users (first_name,last_name,email,password,role,gate_airport_code) VALUES (?,?,?,?,'crew',?)", [first,last,email.toLowerCase(),hash,airport]);
    await require('../services/auditService').logEvent({ userId: req.user.userId, action: 'GATE_STAFF_CREATED', resourceType: 'USER', resourceId: created.insertId, newValue: { role:'crew', airport }, connection });
    await connection.commit(); res.status(201).json({ success: true, message: 'Airport crew account created', data: { user_id: created.insertId } });
  } catch (error) { await connection.rollback(); if (error.code === 'ER_DUP_ENTRY') fail('An account with that email already exists', 409); throw error; }
  finally { connection.release(); }
});
module.exports = router;
