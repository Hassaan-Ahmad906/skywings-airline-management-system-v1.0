/**
 * SkyWings Airlines - Master Database Seeder
 * Seeds Admin credentials, 20 Active Customer Users, Airports, Fleet, Seats, and Flights.
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../backend/config/database');

async function seedDatabase() {
  const connection = await pool.getConnection();
  try {
    console.log('🌱 Starting SkyWings Airlines Database Seeding...');
    await connection.beginTransaction();

    // 1. Hash Passwords
    const adminHash = await bcrypt.hash('admin123', 10);
    const userHash = await bcrypt.hash('user123', 10);

    // 2. Seed Admin & Primary User
    console.log('👤 Seeding System Administrator and Primary User...');
    await connection.execute(
      `INSERT INTO users (first_name, last_name, email, password, phone, date_of_birth, address, role, status)
       VALUES 
       ('System', 'Admin', 'admin@skywings.com', ?, '+1-555-0100', '1985-05-15', 'SkyWings HQ, New York, USA', 'admin', 'active'),
       ('John', 'Doe', 'user@skywings.com', ?, '+1-555-0101', '1992-08-20', '123 Main St, New York, USA', 'user', 'active')
       ON DUPLICATE KEY UPDATE 
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         password = VALUES(password),
         role = VALUES(role),
         status = VALUES(status)`,
      [adminHash, userHash]
    );

    // 3. Seed 20 Realistic Enterprise Customer Users
    console.log('👥 Seeding 20 Active Customer Accounts...');
    const customerUsers = [
      { first: 'Emily', last: 'Clark', email: 'emily.clark@skywings.com', phone: '+1-555-0201', dob: '1990-03-12', address: '456 Oak Ave, Los Angeles, USA', passport: 'US89214710', nationality: 'American' },
      { first: 'David', last: 'Miller', email: 'david.miller@skywings.com', phone: '+1-555-0202', dob: '1988-11-25', address: '789 Pine Rd, Chicago, USA', passport: 'US89214711', nationality: 'American' },
      { first: 'Sarah', last: 'Jenkins', email: 'sarah.jenkins@skywings.com', phone: '+44-20-7946-0101', dob: '1995-07-04', address: '12 Oxford St, London, UK', passport: 'GB78419201', nationality: 'British' },
      { first: 'Michael', last: 'Brown', email: 'michael.brown@skywings.com', phone: '+1-555-0204', dob: '1982-01-18', address: '321 Elm St, Miami, USA', passport: 'US89214713', nationality: 'American' },
      { first: 'Jessica', last: 'Taylor', email: 'jessica.taylor@skywings.com', phone: '+1-555-0205', dob: '1993-09-30', address: '654 Maple Dr, Seattle, USA', passport: 'US89214714', nationality: 'American' },
      { first: 'James', last: 'Anderson', email: 'james.anderson@skywings.com', phone: '+61-2-9374-4001', dob: '1987-04-14', address: '88 George St, Sydney, Australia', passport: 'AU90381241', nationality: 'Australian' },
      { first: 'Olivia', last: 'Martinez', email: 'olivia.martinez@skywings.com', phone: '+34-91-123-4567', dob: '1996-12-08', address: '24 Gran Via, Madrid, Spain', passport: 'ES67129034', nationality: 'Spanish' },
      { first: 'Daniel', last: 'Thomas', email: 'daniel.thomas@skywings.com', phone: '+1-555-0208', dob: '1991-06-22', address: '159 Cedar Ln, Boston, USA', passport: 'US89214717', nationality: 'American' },
      { first: 'Sophia', last: 'Jackson', email: 'sophia.jackson@skywings.com', phone: '+33-1-4268-5500', dob: '1994-02-17', address: '10 Champs-Elysees, Paris, France', passport: 'FR45129834', nationality: 'French' },
      { first: 'William', last: 'White', email: 'william.white@skywings.com', phone: '+1-555-0210', dob: '1980-10-05', address: '753 Birch St, Denver, USA', passport: 'US89214719', nationality: 'American' },
      { first: 'Ava', last: 'Harris', email: 'ava.harris@skywings.com', phone: '+1-555-0211', dob: '1997-08-19', address: '951 Walnut St, Austin, USA', passport: 'US89214720', nationality: 'American' },
      { first: 'Alexander', last: 'Martin', email: 'alexander.martin@skywings.com', phone: '+49-30-2312-500', dob: '1989-05-29', address: '15 Friedrichstrasse, Berlin, Germany', passport: 'DE89234109', nationality: 'German' },
      { first: 'Mia', last: 'Thompson', email: 'mia.thompson@skywings.com', phone: '+1-555-0213', dob: '1998-03-03', address: '357 Spruce Ct, San Francisco, USA', passport: 'US89214722', nationality: 'American' },
      { first: 'Ethan', last: 'Garcia', email: 'ethan.garcia@skywings.com', phone: '+971-4-362-7000', dob: '1986-12-12', address: 'Sheikh Zayed Rd, Dubai, UAE', passport: 'AE56129845', nationality: 'Emirati' },
      { first: 'Charlotte', last: 'Robinson', email: 'charlotte.robinson@skywings.com', phone: '+1-555-0215', dob: '1992-07-27', address: '246 Ash Blvd, Atlanta, USA', passport: 'US89214724', nationality: 'American' },
      { first: 'Lucas', last: 'Clark', email: 'lucas.clark@skywings.com', phone: '+81-3-5555-0143', dob: '1990-09-15', address: 'Minato-ku, Tokyo, Japan', passport: 'JP90412890', nationality: 'Japanese' },
      { first: 'Amelia', last: 'Rodriguez', email: 'amelia.rodriguez@skywings.com', phone: '+1-555-0217', dob: '1995-11-11', address: '135 Willow Way, Phoenix, USA', passport: 'US89214726', nationality: 'American' },
      { first: 'Benjamin', last: 'Lewis', email: 'benjamin.lewis@skywings.com', phone: '+65-6789-0123', dob: '1984-04-02', address: 'Marina Bay Sands, Singapore', passport: 'SG78129045', nationality: 'Singaporean' },
      { first: 'Harper', last: 'Lee', email: 'harper.lee@skywings.com', phone: '+1-555-0219', dob: '1999-01-23', address: '468 Magnolia St, Dallas, USA', passport: 'US89214728', nationality: 'American' },
      { first: 'Henry', last: 'Walker', email: 'henry.walker@skywings.com', phone: '+1-555-0220', dob: '1983-08-08', address: '579 Hickory Rd, Portland, USA', passport: 'US89214729', nationality: 'American' }
    ];

    for (const u of customerUsers) {
      await connection.execute(
        `INSERT INTO users (first_name, last_name, email, password, phone, date_of_birth, address, role, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'active')
         ON DUPLICATE KEY UPDATE 
           first_name = VALUES(first_name),
           last_name = VALUES(last_name),
           password = VALUES(password),
           phone = VALUES(phone),
           address = VALUES(address)`,
        [u.first, u.last, u.email, userHash, u.phone, u.dob, u.address]
      );

      const [userRows] = await connection.execute('SELECT user_id FROM users WHERE email = ?', [u.email]);
      if (userRows.length > 0) {
        const userId = userRows[0].user_id;
        // User Preferences
        await connection.execute(
          `INSERT INTO user_preferences (user_id, preferred_seat, meal_preference, newsletter_subscription)
           VALUES (?, 'window', 'non-vegetarian', TRUE)
           ON DUPLICATE KEY UPDATE preferred_seat = VALUES(preferred_seat)`,
          [userId]
        );
        // Saved Passenger Profile
        await connection.execute(
          `INSERT INTO passengers (user_id, first_name, last_name, date_of_birth, passport_number, nationality, is_saved)
           VALUES (?, ?, ?, ?, ?, ?, TRUE)
           ON DUPLICATE KEY UPDATE passport_number = VALUES(passport_number)`,
          [userId, u.first, u.last, u.dob, u.passport, u.nationality]
        );
      }
    }

    // 4. Seed Standard International Airports
    console.log('🛫 Seeding Airports...');
    const airports = [
      ['NYC', 'John F. Kennedy International Airport', 'New York', 'USA'],
      ['LON', 'Heathrow Airport', 'London', 'UK'],
      ['DXB', 'Dubai International Airport', 'Dubai', 'UAE'],
      ['PAR', 'Charles de Gaulle Airport', 'Paris', 'France'],
      ['TOK', 'Haneda Airport', 'Tokyo', 'Japan'],
      ['LAX', 'Los Angeles International Airport', 'Los Angeles', 'USA'],
      ['CHI', 'O\'Hare International Airport', 'Chicago', 'USA'],
      ['MIA', 'Miami International Airport', 'Miami', 'USA'],
      ['SIN', 'Singapore Changi Airport', 'Singapore', 'Singapore'],
      ['SYD', 'Sydney Kingsford Smith Airport', 'Sydney', 'Australia'],
      ['FRA', 'Frankfurt Airport', 'Frankfurt', 'Germany'],
      ['IST', 'Istanbul Airport', 'Istanbul', 'Turkey']
    ];

    for (const [code, name, city, country] of airports) {
      await connection.execute(
        `INSERT INTO airports (airport_code, airport_name, city, country)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE airport_name = VALUES(airport_name), city = VALUES(city), country = VALUES(country)`,
        [code, name, city, country]
      );
    }

    // 5. Seed Aircraft Fleet
    console.log('✈️ Seeding Aircraft Fleet...');
    const fleet = [
      ['Boeing 737-800', 'SW-001', 180, 'active'],
      ['Boeing 777-300ER', 'SW-002', 365, 'active'],
      ['Airbus A320neo', 'SW-003', 180, 'active'],
      ['Airbus A350-900', 'SW-004', 325, 'active']
    ];

    for (const [model, reg, capacity, status] of fleet) {
      await connection.execute(
        `INSERT INTO aircraft (model, registration, capacity, status)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE model = VALUES(model), capacity = VALUES(capacity), status = VALUES(status)`,
        [model, reg, capacity, status]
      );
    }

    // 6. Generate Aircraft Physical Seat Maps (Bulk Batch Insert)
    console.log('💺 Generating Aircraft Physical Seat Maps (Fast Batch Insert)...');
    const [aircraftRows] = await connection.execute('SELECT aircraft_id, model, capacity FROM aircraft');
    for (const plane of aircraftRows) {
      const rowsCount = plane.capacity === 365 ? 42 : (plane.capacity === 325 ? 40 : 30);
      const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
      const seatValues = [];
      const seatParams = [];

      for (let r = 1; r <= rowsCount; r++) {
        for (const col of cols) {
          const seatNumber = `${r}${col}`;
          const seatClass = r <= 3 ? 'business' : (r <= 5 && plane.capacity > 300 ? 'first' : 'economy');
          seatValues.push('(?, ?, ?, ?, ?, TRUE)');
          seatParams.push(plane.aircraft_id, seatNumber, seatClass, r, col);
        }
      }

      if (seatValues.length > 0) {
        await connection.execute(
          `INSERT INTO seats (aircraft_id, seat_number, seat_class, \`row_number\`, column_letter, is_available)
           VALUES ${seatValues.join(', ')}
           ON DUPLICATE KEY UPDATE seat_class = VALUES(seat_class)`,
          seatParams
        );
      }
    }

    // 7. Seed Scheduled Flights Spanning Future Schedule
    console.log('📅 Seeding Scheduled Flights...');
    const flights = [
      ['SW101', 1, 'NYC', 'LAX', 2, 6, 299.00, 599.00, 999.00],
      ['SW102', 1, 'LAX', 'NYC', 3, 6, 299.00, 599.00, 999.00],
      ['SW201', 2, 'LON', 'NYC', 4, 8, 599.00, 1199.00, 1999.00],
      ['SW202', 2, 'NYC', 'LON', 5, 8, 599.00, 1199.00, 1999.00],
      ['SW301', 3, 'CHI', 'MIA', 3, 3, 189.00, 399.00, 699.00],
      ['SW302', 3, 'MIA', 'CHI', 4, 3, 189.00, 399.00, 699.00],
      ['SW401', 4, 'PAR', 'DXB', 6, 7, 499.00, 999.00, 1599.00],
      ['SW402', 4, 'DXB', 'TOK', 7, 9, 699.00, 1399.00, 2299.00],
      ['SW501', 2, 'SIN', 'SYD', 8, 8, 550.00, 1100.00, 1850.00],
      ['SW601', 1, 'FRA', 'IST', 5, 4, 250.00, 520.00, 890.00],
      ['SW701', 4, 'TOK', 'SIN', 9, 7, 480.00, 950.00, 1450.00],
      ['SW801', 3, 'IST', 'LON', 10, 4, 270.00, 560.00, 920.00]
    ];

    for (const [fNum, acIdx, fromCode, toCode, daysAhead, durationHrs, baseP, bizP, firstP] of flights) {
      const plane = aircraftRows[acIdx - 1] || aircraftRows[0];
      await connection.execute(
        `INSERT INTO flights (flight_number, aircraft_id, from_airport_code, to_airport_code, departure_datetime, arrival_datetime, status, base_price, business_price, first_class_price)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), DATE_ADD(DATE_ADD(NOW(), INTERVAL ? DAY), INTERVAL ? HOUR), 'scheduled', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           departure_datetime = VALUES(departure_datetime),
           arrival_datetime = VALUES(arrival_datetime),
           base_price = VALUES(base_price),
           business_price = VALUES(business_price),
           first_class_price = VALUES(first_class_price),
           status = 'scheduled'`,
        [fNum, plane.aircraft_id, fromCode, toCode, daysAhead, daysAhead, durationHrs, baseP, bizP, firstP]
      );
    }

    await connection.commit();
    console.log('✅ SkyWings Airlines Database Seeding Completed Successfully!');
    console.log('📊 Summary:');
    console.log('   - 1 Administrator Account (admin@skywings.com / admin123)');
    console.log('   - 1 Standard Customer Account (user@skywings.com / user123)');
    console.log('   - 20 Dedicated Active Customer Accounts (user123)');
    console.log('   - 12 International Airports');
    console.log('   - 4 Active Fleet Aircraft with Complete Seat Maps');
    console.log('   - 12 Scheduled Multi-Cabin Flights');
  } catch (error) {
    await connection.rollback();
    console.error('❌ Seeding Error:', error);
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = seedDatabase;
