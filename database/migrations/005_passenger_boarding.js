module.exports = async connection => {
  const [columns] = await connection.query('SHOW COLUMNS FROM booking_passengers');
  const names = new Set(columns.map(column => column.Field));
  if (!names.has('boarding_token')) await connection.query('ALTER TABLE booking_passengers ADD COLUMN boarding_token VARCHAR(64) NULL');
  const [indexes] = await connection.query('SHOW INDEX FROM booking_passengers');
  if (!indexes.some(index => index.Key_name === 'uq_passenger_boarding_token')) {
    await connection.query('ALTER TABLE booking_passengers ADD UNIQUE KEY uq_passenger_boarding_token (boarding_token)');
  }
  if (!names.has('boarded_at')) await connection.query('ALTER TABLE booking_passengers ADD COLUMN boarded_at DATETIME NULL');
};
