const { query } = require('../config/database');

class FlightRepository {
  /**
   * Acquire row-level lock on flight and aircraft data for booking transaction
   * @param {Object} connection - Active database transaction connection
   * @param {number} flightId - ID of flight to lock
   * @param {string} flightClass - Requested cabin class
   */
  async findByIdForUpdate(connection, flightId, flightClass = 'economy') {
    const [rows] = await connection.execute(
      `SELECT f.*, a.capacity, a.aircraft_id,
        CASE 
          WHEN ? = 'economy' THEN f.base_price
          WHEN ? = 'business' THEN f.business_price
          WHEN ? = 'first' THEN f.first_class_price
          ELSE f.base_price
        END as price
       FROM flights f
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       WHERE f.flight_id = ?
         AND LOWER(f.status) IN ('scheduled', 'boarding', 'in_air', 'active')
         AND f.departure_datetime > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [flightClass, flightClass, flightClass, flightId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get flight details without lock
   */
  async findById(flightId) {
    const [rows] = await query(
      `SELECT f.*, a.capacity, a.model as aircraft_model
       FROM flights f
       INNER JOIN aircraft a ON f.aircraft_id = a.aircraft_id
       WHERE f.flight_id = ?`,
      [flightId]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

module.exports = new FlightRepository();
