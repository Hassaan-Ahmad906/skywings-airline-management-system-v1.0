const seatHoldService = require('../services/seatHoldService');

class SeatHoldController {
  async createOrChangeHold(req, res) {
    try {
      const userId = req.user.userId;
      const { flight_id, seat_number, session_id, passenger_index = 0 } = req.body;

      if (!flight_id || !seat_number || !session_id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'flight_id, seat_number, and session_id are required'
          }
        });
      }

      const hold = await seatHoldService.createOrChangeHold(userId, {
        flight_id,
        seat_number,
        session_id,
        passenger_index
      });

      res.status(201).json({
        success: true,
        message: 'Seat held successfully',
        data: {
          hold_id: hold.hold_id,
          flight_id: hold.flight_id,
          seat_number: hold.seat_number,
          session_id: hold.session_id,
          passenger_index: hold.passenger_index,
          status: hold.status,
          expires_at: hold.expires_at
        }
      });
    } catch (error) {
      console.error('Create seat hold controller error:', error.message);

      const statusCode = error.status || 500;
      const errorCode = error.code || 'HOLD_FAILED';

      res.status(statusCode).json({
        success: false,
        error: {
          code: errorCode,
          message: error.message || 'Failed to hold seat'
        }
      });
    }
  }

  async releaseHold(req, res) {
    try {
      const userId = req.user.userId;
      const holdId = parseInt(req.params.id, 10);

      if (isNaN(holdId)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid hold ID'
          }
        });
      }

      const result = await seatHoldService.releaseHold(userId, holdId);
      res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      console.error('Release seat hold controller error:', error.message);

      const statusCode = error.status || 500;
      const errorCode = error.code || 'RELEASE_FAILED';

      res.status(statusCode).json({
        success: false,
        error: {
          code: errorCode,
          message: error.message || 'Failed to release seat hold'
        }
      });
    }
  }
}

module.exports = new SeatHoldController();
