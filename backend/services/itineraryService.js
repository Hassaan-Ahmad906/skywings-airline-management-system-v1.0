const db = require('../config/database'), crypto = require('node:crypto');
const flightsRepo = require('../repositories/flightRepository'), bookingsRepo = require('../repositories/bookingRepository');
const validation = require('./journeyValidation');
function conflict(message) { throw Object.assign(new Error(message), { status:409, code:'JOURNEY_CONFLICT' }); }
async function details(connection, userId, id) {
  const [[itinerary]] = await connection.execute('SELECT * FROM itineraries WHERE itinerary_id = ? AND user_id = ?', [id,userId]);
  if (!itinerary) throw Object.assign(new Error('Journey not found'), { status:404 });
  const [bookings] = await connection.execute(`SELECT b.*, f.flight_number, f.from_airport_code, f.to_airport_code, f.departure_datetime, f.arrival_datetime
    FROM bookings b JOIN flights f ON f.flight_id = b.flight_id WHERE b.itinerary_id = ? ORDER BY b.segment_index`, [id]);
  return { ...itinerary, booking_reference:itinerary.itinerary_reference, bookings, reservation_expires_at:bookings[0]?.reservation_expires_at };
}
async function create(userId, data) {
  const { flight_ids: ids, passengers, trip_type: type, class: cabin = 'economy', idempotency_key:key } = data || {};
  if (!Array.isArray(ids) || ids.length<1 || ids.length>6 || new Set(ids.map(Number)).size !== ids.length ||
    !ids.every(id => Number.isSafeInteger(Number(id)) && Number(id)>0) || !['oneway','return','multicity'].includes(type) ||
    (type==='oneway' && ids.length!==1) || (type==='return' && ids.length!==2) || (type==='multicity' && ids.length<2) ||
    typeof key !== 'string' || !key || key.length>100) validation.fail('Provide a valid trip type, unique flight legs and reservation key');
  require('./bookingValidation').validateBooking({ flight_id:ids[0], passengers, class:cabin });
  if (passengers.some(p => p.seat_number != null)) validation.fail('Choose seats separately during check-in for each flight');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ ids:ids.map(Number), passengers, type, cabin })).digest('hex');
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    // Lock all flights in numeric order before any booking or passenger rows.
    const flightMap = new Map();
    for (const id of ids.map(Number).sort((a,b)=>a-b)) {
      const flight = await flightsRepo.findByIdForUpdate(connection,id,cabin);
      if (!flight) conflict('A selected flight is no longer available');
      flightMap.set(id,flight);
    }
    const [[existing]] = await connection.execute('SELECT * FROM itineraries WHERE user_id = ? AND idempotency_key = ? FOR UPDATE', [userId,key]);
    if (existing) {
      if (existing.request_hash !== fingerprint) conflict('This reservation key belongs to a different journey');
      const result = await details(connection,userId,existing.itinerary_id); await connection.commit(); return result;
    }
    const flights = ids.map(id => flightMap.get(Number(id)));
    validation.validateChronology(flights,type);
    for (const flight of flights) await bookingsRepo.assertCapacity(connection,flight,cabin,passengers.length);
    const total = flights.reduce((sum,f)=>sum+Math.round(Number(f.price)*100)*passengers.length,0)/100;
    const reference = 'IT' + crypto.randomBytes(9).toString('hex').toUpperCase();
    const [created] = await connection.execute('INSERT INTO itineraries (itinerary_reference,user_id,trip_type,class,total_amount,idempotency_key,request_hash) VALUES (?,?,?,?,?,?,?)', [reference,userId,type,cabin,total,key,fingerprint]);
    const passengerIds = [];
    for (const [index, flight] of flights.entries()) {
      const bookingId = await bookingsRepo.createBooking(connection,{ booking_reference:'BK'+crypto.randomBytes(9).toString('hex').toUpperCase(),user_id:userId,flight_id:flight.flight_id,number_of_passengers:passengers.length,class:cabin,total_amount:Number(flight.price)*passengers.length });
      await connection.execute('UPDATE bookings SET itinerary_id = ?, segment_index = ? WHERE booking_id = ?', [created.insertId,index,bookingId]);
      for (const [pIndex,p] of passengers.entries()) {
        const pId = await bookingsRepo.addPassengerToBooking(connection,bookingId,userId,index ? { passenger_id:passengerIds[pIndex] } : p);
        if (!index) passengerIds.push(pId);
      }
    }
    await require('./auditService').logEvent({ userId, action:'JOURNEY_RESERVED',resourceType:'ITINERARY',resourceId:created.insertId,newValue:{ reference, flight_ids:ids.map(Number), passenger_count:passengers.length, total_amount:total },connection });
    const result = await details(connection,userId,created.insertId); await connection.commit(); return result;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
async function pay(userId,id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id)<1) validation.fail('Invalid journey');
  const payment = require('./paymentService');
  if (!payment.demoEnabled()) throw Object.assign(new Error('Online payment is unavailable'), { status:503 });
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const journey = await details(connection,userId,Number(id));
    const flights=new Map();
    for (const flightId of [...new Set(journey.bookings.map(b=>b.flight_id))].sort((a,b)=>a-b)) {
      const [[flight]]=await connection.execute('SELECT * FROM flights WHERE flight_id = ? FOR UPDATE',[flightId]);
      if (!flight) conflict('A journey flight is no longer available');
      flights.set(flightId,flight);
    }
    validation.validateChronology(journey.bookings.map(b=>flights.get(b.flight_id)),journey.trip_type);
    for (const booking of journey.bookings) await payment.confirmDemoPayment(userId,booking.booking_id,connection);
    await connection.commit(); return { itinerary_id:Number(id),demo:true };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
module.exports = { create,pay,details };
