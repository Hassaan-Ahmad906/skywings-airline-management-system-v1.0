const db = require('../config/database');
const { validateLegs, fail } = require('./journeyValidation');
async function search(legs, type, cabin, passengers) {
  validateLegs(legs, type);
  if (!['economy','business','first'].includes(cabin) || !Number.isSafeInteger(Number(passengers)) || Number(passengers)<1 || Number(passengers)>9) fail('Choose a cabin and 1–9 passengers');
  const priceColumn = { economy:'base_price', business:'business_price', first:'first_class_price' }[cabin];
  const results = [];
  for (const leg of legs) {
    const [flights] = await db.pool.query(`SELECT f.*, dep.airport_code AS from_code, dep.city AS from_city,
      arr.airport_code AS to_code, arr.city AS to_city, a.model AS aircraft_model,
      f.${priceColumn} AS price, ${require('../repositories/inventorySql')} AS available_seats
      FROM flights f JOIN airports dep ON dep.airport_code = f.from_airport_code JOIN airports arr ON arr.airport_code = f.to_airport_code
      JOIN aircraft a ON a.aircraft_id = f.aircraft_id WHERE f.from_airport_code = ? AND f.to_airport_code = ?
      AND DATE(f.departure_datetime) = ? AND f.departure_datetime > NOW() AND f.status IN ('scheduled','delayed','boarding') AND a.status = 'active'
      HAVING available_seats >= ? ORDER BY price, departure_datetime LIMIT 100`, [...Array(3).fill(cabin), leg.from, leg.to, leg.departure, Number(passengers)]);
    results.push({ ...leg, flights: flights.map(f => ({ ...f, available_seats:Number(f.available_seats), price:Number(f.price), total_price:Number(f.price)*Number(passengers) })) });
  }
  return { legs:results, trip_type:type, class:cabin, passengers:Number(passengers), currency:'USD' };
}
module.exports = { search };
