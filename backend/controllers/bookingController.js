const bookingService = require('../services/bookingService');

class BookingController {
  async holdSeat(req, res) {
    try {
      const userId = req.user.userId;
      const { flight_id, seat_numbers, duration_minutes = 10 } = req.body;

      if (!flight_id || !seat_numbers || !Array.isArray(seat_numbers)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'flight_id and an array of seat_numbers are required'
          }
        });
      }

      const result = await bookingService.holdSeats(userId, flight_id, seat_numbers, duration_minutes);

      res.status(200).json({
        success: true,
        message: `Seat(s) held successfully for ${duration_minutes} minutes`,
        data: result
      });
    } catch (error) {
      console.error('Hold seat controller error:', error.message);
      
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

  async createBooking(req, res) {
    try {
      const userId = req.user.userId;
      const booking = await bookingService.createBooking(userId, req.body);

      res.status(201).json({
        success: true,
        message: 'Booking created successfully',
        data: { booking }
      });
    } catch (error) {
      console.error('Booking controller error:', error.message);
      
      const statusCode = error.status || 500;
      const errorCode = error.code || 'BOOKING_FAILED';

      res.status(statusCode).json({
        success: false,
        error: {
          code: errorCode,
          message: error.message || 'Failed to create booking'
        }
      });
    }
  }

  async cancelBooking(req, res) {
    try {
      const userId = req.user.userId;
      const bookingId = parseInt(req.params.id);

      if (isNaN(bookingId)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Invalid booking ID'
          }
        });
      }

      const result = await bookingService.cancelBooking(userId, bookingId);
      res.json({
        success: true,
        message: result.message
      });
    } catch (error) {
      console.error('Cancel booking controller error:', error.message);
      
      const statusCode = error.status || 500;
      const errorCode = error.code || 'CANCEL_FAILED';

      res.status(statusCode).json({
        success: false,
        error: {
          code: errorCode,
          message: error.message || 'Failed to cancel booking'
        }
      });
    }
  }
}

module.exports = new BookingController();
