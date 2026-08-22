const db = require('../config/database');
const seatHoldRepository = require('../repositories/seatHoldRepository');

class SeatHoldCleaner {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
  }

  start(intervalMs = 60000) {
    if (this.intervalId) return;

    console.log('🔄 SeatHoldCleaner background worker initialized (Interval: 60s)');
    
    // Initial run
    this.runCleanup();

    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 SeatHoldCleaner background worker stopped.');
    }
  }

  async runCleanup() {
    if (this.isRunning) return;
    this.isRunning = true;

    let connection;
    try {
      connection = await db.pool.getConnection();
      await seatHoldRepository.cleanupExpiredHolds(connection);
    } catch (err) {
      console.error('SeatHoldCleaner background cleanup error:', err.message);
    } finally {
      if (connection) connection.release();
      this.isRunning = false;
    }
  }
}

module.exports = new SeatHoldCleaner();
