const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../backend/config/database');
const bookingService = require('../backend/services/bookingService');
const paymentService = require('../backend/services/paymentService');
const stateMachine = require('../backend/services/bookingStateMachine');
const seatAllocation = require('../backend/services/seatAllocationService');
const names = [
  ['Ali','Raza','Karachi'], ['Ayesha','Khan','Lahore'], ['Hassan','Ahmed','Islamabad'],
  ['Fatima','Malik','Rawalpindi'], ['Usman','Iqbal','Peshawar'], ['Sana','Ahmed','Multan'],
  ['Bilal','Hussain','Faisalabad'], ['Zainab','Sheikh','Sialkot'], ['Hamza','Ali','Quetta'],
  ['Mariam','Farooq','Karachi'], ['Zoya','Siddiqui','Lahore'], ['Danish','Abbasi','Islamabad']
];
const airports = [
  ['KHI','Jinnah International Airport','Karachi','Pakistan'], ['LHE','Allama Iqbal International Airport','Lahore','Pakistan'],
  ['ISB','Islamabad International Airport','Islamabad','Pakistan'], ['PEW','Bacha Khan International Airport','Peshawar','Pakistan'],
  ['UET','Quetta International Airport','Quetta','Pakistan'], ['MUX','Multan International Airport','Multan','Pakistan'],
  ['SKT','Sialkot International Airport','Sialkot','Pakistan'], ['LYP','Faisalabad International Airport','Faisalabad','Pakistan'],
  ['DXB','Dubai International Airport','Dubai','United Arab Emirates'], ['DOH','Hamad International Airport','Doha','Qatar'],
  ['JED','King Abdulaziz International Airport','Jeddah','Saudi Arabia'], ['RUH','King Khalid International Airport','Riyadh','Saudi Arabia']
];
async function checkInSeed(bookingId, userId, seats) {
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT b.*, f.aircraft_id, f.departure_datetime FROM bookings b JOIN flights f ON f.flight_id = b.flight_id WHERE b.booking_id = ? FOR UPDATE', [bookingId]);
    const booking = rows[0];
    await seatAllocation.processSeatAllocations(connection, booking.flight_id, booking.aircraft_id, bookingId, userId, seats.map(seat_number => ({ seat_number })), booking.class);
    const [passengers] = await connection.execute('SELECT * FROM booking_passengers WHERE booking_id = ? ORDER BY booking_passenger_id', [bookingId]);
    for (let i = 0; i < passengers.length; i++) {
      await connection.execute('UPDATE booking_passengers SET seat_number = ?, boarding_token = ? WHERE booking_passenger_id = ?', [seats[i], crypto.randomBytes(32).toString('hex'), passengers[i].booking_passenger_id]);
      await connection.execute('UPDATE tickets SET seat_number = ? WHERE booking_id = ? AND passenger_id = ?', [seats[i], bookingId, passengers[i].passenger_id]);
    }
    await connection.execute("INSERT INTO check_ins (booking_id, gate_number, boarding_time, status) VALUES (?, 'A1', ?, 'completed')", [bookingId, new Date(new Date(booking.departure_datetime).getTime() - 1800000)]);
    await stateMachine.transitionBookingState(connection, bookingId, 'CHECKED_IN', { type: 'CHECKIN_AGENT', userId }, 'Synthetic seed check-in');
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
async function seedDatabase() {
  if (process.env.NODE_ENV === 'production' || !paymentService.demoEnabled()) throw new Error('Sample seeding requires development/test mode and PAYMENT_MODE=demo');
  const [[existing]] = await db.pool.execute('SELECT COUNT(*) AS count FROM users');
  if (existing.count) { console.log('Database contains users; seeding skipped. Use db:reset for a fresh demo dataset.'); return { skipped: true }; }
  const hash = await bcrypt.hash('DemoPass123!', 10);
  const people = [];
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT INTO users (first_name, last_name, email, password, role, address) VALUES ('Ahmed','Farooq','admin@skywings.com',?,'admin','Demo airline office, Karachi, Pakistan')", [hash]);
    for (const [index, [first,last,city]] of names.entries()) {
      const email = index === 0 ? 'user@skywings.com' : `${first}.${last}@example.test`.toLowerCase();
      const dob = `${1988 + index}-05-15`;
      const [user] = await connection.execute('INSERT INTO users (first_name, last_name, email, password, date_of_birth, address) VALUES (?, ?, ?, ?, ?, ?)', [first,last,email,hash,dob,`Demo neighbourhood, ${city}, Pakistan`]);
      const [passenger] = await connection.execute("INSERT INTO passengers (user_id, first_name, last_name, date_of_birth, passport_number, nationality, is_saved) VALUES (?, ?, ?, ?, ?, 'Pakistani', 1)", [user.insertId,first,last,dob,`PK-DEMO-${String(index+1).padStart(4,'0')}`]);
      people.push({ userId: user.insertId, passengerId: passenger.insertId });
    }
    await connection.execute("INSERT INTO users (first_name,last_name,email,password,role,gate_airport_code) VALUES ('Hamza','Iqbal','crew@skywings.com',?,'crew','KHI')", [hash]);
    for (const airport of airports) await connection.execute('INSERT INTO airports (airport_code, airport_name, city, country) VALUES (?, ?, ?, ?)', airport);
    for (const [index, model] of ['Airbus A320 (demo cabin)','Airbus A321 (demo cabin)','Boeing 737 (demo cabin)','Airbus A320 (demo cabin)'].entries()) {
      const [plane] = await connection.execute("INSERT INTO aircraft (model, registration, capacity, status) VALUES (?, ?, 72, 'active')", [model,`AP-SW${String.fromCharCode(65+index)}`]);
      for (let row = 1; row <= 12; row++) for (const letter of ['A','B','C','D','E','F']) await connection.execute('INSERT INTO seats (aircraft_id, seat_number, seat_class, `row_number`, column_letter) VALUES (?, ?, ?, ?, ?)', [plane.insertId,`${row}${letter}`,row === 1 ? 'first' : row <= 3 ? 'business' : 'economy',row,letter]);
    }
    const routes = [['KHI','ISB'],['LHE','KHI'],['ISB','LHE'],['KHI','LHE'],['KHI','ISB'],['KHI','ISB'],['LHE','DXB'],['ISB','DOH'],['KHI','JED'],['PEW','KHI'],['MUX','ISB'],['SKT','RUH'],['UET','KHI'],['LYP','KHI']];
    const now = Date.now();
    for (let i = 0; i < 60; i++) {
      const [from,to] = routes[i % routes.length];
      const departure = i === 0 ? new Date(now + 3600000) : i === 1 ? new Date(now + 6*3600000) : new Date(now + (24 + i*12)*3600000);
      const international = ['DXB','DOH','JED','RUH'].includes(to);
      const arrival = new Date(departure.getTime() + (international ? 4 : 2)*3600000);
      const fare = international ? 260 : 120;
      await connection.execute('INSERT INTO flights (flight_number, aircraft_id, from_airport_code, to_airport_code, departure_datetime, arrival_datetime, base_price, business_price, first_class_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [`SW${201+i}`,i%4+1,from,to,departure,arrival,fare,fare*1.5,fare*2,i === 6 ? 'delayed' : 'scheduled']);
    }
    for (let i = 0; i < 3; i++) await connection.execute("INSERT INTO flights (flight_number, aircraft_id, from_airport_code, to_airport_code, departure_datetime, arrival_datetime, base_price, business_price, first_class_price) VALUES (?, ?, 'KHI','ISB', ?, ?, 120, 180, 240)", [`SW${901+i}`,i+2,new Date(now+3600000),new Date(now+3*3600000)]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  async function book(personIndex, flightId, cabin = 'economy', seat = null, extra = []) {
    const person = people[personIndex];
    return bookingService.createBooking(person.userId, { flight_id: flightId, class: cabin,
      idempotency_key: `seed-${personIndex}-${flightId}-${cabin}`,
      passengers: [{ passenger_id: person.passengerId, ...(seat ? { seat_number: seat } : {}) }, ...extra] });
  }
  async function paid(personIndex, flightId, cabin, seat, extra) {
    const booking = await book(personIndex, flightId, cabin, seat, extra);
    await paymentService.confirmDemoPayment(people[personIndex].userId, booking.booking_id); return booking;
  }
  const checked = await paid(0,1,'economy','4A',[{ first_name:'Ayesha',last_name:'Raza',date_of_birth:'2002-03-10',nationality:'Pakistani',seat_number:'4B' }]);
  await checkInSeed(checked.booking_id, people[0].userId, ['4A','4B']);
  await paid(0,2,'business','2A');
  await book(0,4);
  const expired = await book(0,3,'economy','4C');
  await db.pool.execute('UPDATE bookings SET reservation_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE booking_id = ?', [expired.booking_id]);
  for (let i = 1; i < people.length; i++) await paid(i, i+7, i%3 === 0 ? 'business' : i%4 === 0 ? 'first' : 'economy', i%3 === 0 ? '2A' : i%4 === 0 ? '1A' : '4A');
  const moved = await paid(3,5,'economy','4D');
  const rebookConnection = await db.pool.getConnection();
  try { await rebookConnection.beginTransaction(); await require('../backend/services/rebookingService').executeRebooking(rebookConnection,moved.booking_id,6,[], 'CUSTOMER_REQUEST', { userId:people[3].userId,role:'user' }, 'seed-rebooking'); await rebookConnection.commit(); }
  catch(error) { await rebookConnection.rollback(); throw error; } finally { rebookConnection.release(); }
  const completed = await paid(0,61,'economy','4A');
  await checkInSeed(completed.booking_id, people[0].userId, ['4A']);
  const [tokens] = await db.pool.execute('SELECT boarding_token FROM booking_passengers WHERE booking_id = ?', [completed.booking_id]);
  await db.pool.execute('UPDATE flights SET boarding_open = 1 WHERE flight_id = 61');
  await require('../backend/services/boardingService').scan(tokens[0].boarding_token,61,{role:'admin',userId:1});
  await db.pool.execute("UPDATE flights SET status = 'completed', departure_datetime = DATE_SUB(NOW(), INTERVAL 30 DAY), arrival_datetime = DATE_ADD(DATE_SUB(NOW(), INTERVAL 30 DAY), INTERVAL 2 HOUR) WHERE flight_id = 61");
  const cancelled = await paid(0,62,'economy','4B');
  await bookingService.cancelBooking(people[0].userId,cancelled.booking_id);
  await db.pool.execute("UPDATE flights SET status = 'cancelled', departure_datetime = DATE_SUB(NOW(), INTERVAL 15 DAY), arrival_datetime = DATE_ADD(DATE_SUB(NOW(), INTERVAL 15 DAY), INTERVAL 2 HOUR) WHERE flight_id = 62");
  const missed = await paid(0,63,'economy',null);
  await db.pool.execute("UPDATE flights SET status = 'completed', departure_datetime = DATE_SUB(NOW(), INTERVAL 7 DAY), arrival_datetime = DATE_ADD(DATE_SUB(NOW(), INTERVAL 7 DAY), INTERVAL 2 HOUR) WHERE flight_id = 63");
  await require('../backend/services/lifecycleService').runSweep();
  await db.pool.execute('UPDATE bookings SET booking_date = DATE_SUB(NOW(), INTERVAL 30 DAY) WHERE booking_id = ?', [completed.booking_id]);
  await db.pool.execute("INSERT INTO contact_messages (name,email,category,message) VALUES ('Sana Ahmed','sana.ahmed@example.test','feedback','This is a synthetic support inquiry for the Pakistani demo dataset.')");
  console.log('Pakistani demo data seeded: 14 accounts, 12 airports, 4 aircraft, 288 seats, 63 flights and lifecycle examples.');
  return { people, checkedBookingId: checked.booking_id, completedBookingId: completed.booking_id, missedBookingId: missed.booking_id };
}
if (require.main === module) seedDatabase().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.pool.end());
module.exports = seedDatabase;
