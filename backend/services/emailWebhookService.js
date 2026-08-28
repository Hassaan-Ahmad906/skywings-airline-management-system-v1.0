const https = require('https');
const http = require('http');
const { URL } = require('url');
const bookingRepository = require('../repositories/bookingRepository');
const auditService = require('./auditService');

const PRODUCTION_WEBHOOK_URL = 'https://hassaanahmad2.app.n8n.cloud/webhook/c1c5404e-9aa6-4f33-b58e-8de402b5403c';

class EmailWebhookService {
  /**
   * Get configured webhook URL (with fallback to production n8n webhook)
   */
  getWebhookUrl() {
    return process.env.N8N_EMAIL_WEBHOOK_URL || PRODUCTION_WEBHOOK_URL;
  }

  /**
   * Format ISO date/time into standard YYYY-MM-DD
   */
  formatDate(dateInput) {
    if (!dateInput) return 'N/A';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /**
   * Format ISO date/time into HH:MM (24-hour)
   */
  formatTime(dateInput) {
    if (!dateInput) return 'N/A';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * Calculate flight duration string (e.g., "7h 30m")
   */
  calculateDuration(departureInput, arrivalInput) {
    if (!departureInput || !arrivalInput) return 'N/A';
    const dep = new Date(departureInput);
    const arr = new Date(arrivalInput);
    const diffMs = arr.getTime() - dep.getTime();
    if (isNaN(diffMs) || diffMs <= 0) return 'N/A';

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  }

  /**
   * Determine baggage allowance string based on travel class
   */
  getBaggageAllowance(flightClass) {
    const normalizedClass = (flightClass || 'economy').toLowerCase();
    switch (normalizedClass) {
      case 'first':
        return '3 checked bags (up to 32 kg / 70 lbs each) + 2 carry-on (up to 12 kg each)';
      case 'business':
        return '2 checked bags (up to 32 kg / 70 lbs each) + 2 carry-on (up to 10 kg each)';
      case 'economy':
      default:
        return '1 checked bag (up to 23 kg / 50 lbs) + 1 carry-on (up to 7 kg)';
    }
  }

  /**
   * Build JSON payload matching target n8n email schema from real database booking data
   */
  buildPayload(booking) {
    const passengers = booking.passengers || [];
    const tickets = booking.tickets || [];

    // Customer Name
    const customerName = `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || 'Valued Customer';
    const customerEmail = booking.customer_email || '';

    // Passenger Name (Primary passenger or comma-separated list)
    const passengerNames = passengers.map(p => `${p.first_name || ''} ${p.last_name || ''}`.trim()).filter(Boolean);
    const primaryPassengerName = passengerNames.length > 0 ? passengerNames[0] : customerName;

    // Travel Class
    const rawClass = booking.class || 'economy';
    const formattedClass = rawClass.charAt(0).toUpperCase() + rawClass.slice(1).toLowerCase();

    // Seats
    const assignedSeats = passengers
      .map(p => p.seat_number)
      .filter(Boolean);
    if (assignedSeats.length === 0 && tickets.length > 0) {
      tickets.forEach(t => {
        if (t.seat_number) assignedSeats.push(t.seat_number);
      });
    }
    const seatNumberString = assignedSeats.length > 0
      ? assignedSeats.join(', ')
      : 'Unassigned (select at check-in)';

    // Departure & Arrival Airport Strings
    const departureAirport = booking.departure_airport_name
      ? `${booking.departure_airport_name} (${booking.departure_airport_code})`
      : (booking.departure_airport_code || 'N/A');

    const arrivalAirport = booking.arrival_airport_name
      ? `${booking.arrival_airport_name} (${booking.arrival_airport_code})`
      : (booking.arrival_airport_code || 'N/A');

    // Check-in Info
    let checkInInfo = `Online check-in opens 24 hours prior to departure. Use Booking Reference (${booking.booking_reference}) and passenger last name to check in.`;
    if (booking.check_in_id && booking.check_in_status === 'completed') {
      checkInInfo = `Checked-in. Gate: ${booking.gate_number || 'TBA'}, Boarding Time: ${this.formatTime(booking.boarding_time) || 'TBA'}`;
    }

    // Flight Duration
    const duration = this.calculateDuration(booking.departure_datetime, booking.arrival_datetime);

    // Total Amount formatted safely
    const amountPaid = typeof booking.total_amount === 'number'
      ? booking.total_amount.toFixed(2)
      : parseFloat(booking.total_amount || 0).toFixed(2);

    return {
      event_type: 'payment_confirmed',
      payment_status: 'confirmed',
      customer: {
        name: customerName,
        email: customerEmail
      },
      passenger: {
        name: primaryPassengerName
      },
      booking: {
        booking_reference: booking.booking_reference,
        booking_status: (booking.status || 'confirmed').toLowerCase(),
        number_of_passengers: String(booking.number_of_passengers || passengers.length || 1)
      },
      flight: {
        airline: 'SkyWings Airlines',
        flight_number: booking.flight_number,
        class: formattedClass,
        duration: duration,
        departure: {
          airport: departureAirport,
          date: this.formatDate(booking.departure_datetime),
          time: this.formatTime(booking.departure_datetime)
        },
        arrival: {
          airport: arrivalAirport,
          date: this.formatDate(booking.arrival_datetime),
          time: this.formatTime(booking.arrival_datetime)
        }
      },
      seat: {
        number: seatNumberString
      },
      baggage: {
        allowance: this.getBaggageAllowance(rawClass)
      },
      payment: {
        status: 'confirmed',
        amount: amountPaid,
        currency: process.env.CURRENCY || 'USD',
        method: booking.payment_method || 'Credit Card'
      },
      check_in: {
        information: checkInInfo
      }
    };
  }

  /**
   * Perform HTTP POST request to external webhook
   */
  async postJson(webhookUrl, payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(webhookUrl);
      const postData = JSON.stringify(payload);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'SkyWings-Airline-Backend/1.0'
        },
        timeout: timeoutMs
      };

      const req = client.request(options, (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: res.statusCode,
              body: responseBody
            });
          } else {
            const err = new Error(`n8n webhook responded with status ${res.statusCode}: ${responseBody}`);
            err.statusCode = res.statusCode;
            err.responseBody = responseBody;
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`n8n webhook request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Main entry point: Gather dynamic booking data and trigger n8n email webhook
   * Safe asynchronous execution that logs errors without crashing or throwing
   */
  async triggerPaymentConfirmationWebhook(bookingId, connection = null) {
    try {
      if (!bookingId) {
        console.warn('⚠️ [EmailWebhookService] triggerPaymentConfirmationWebhook called without bookingId');
        return { success: false, reason: 'MISSING_BOOKING_ID' };
      }

      // Fetch comprehensive dynamic data from project database
      const booking = await bookingRepository.getCompleteBookingDetails(connection, bookingId);
      if (!booking) {
        console.warn(`⚠️ [EmailWebhookService] Booking ID ${bookingId} not found in database`);
        return { success: false, reason: 'BOOKING_NOT_FOUND' };
      }

      // Only trigger if payment is confirmed
      const paymentStatus = (booking.payment_status || '').toLowerCase();
      const bookingStatus = (booking.status || '').toUpperCase();
      if (paymentStatus !== 'paid' && bookingStatus !== 'CONFIRMED') {
        console.warn(`⚠️ [EmailWebhookService] Skipping webhook for booking ${booking.booking_reference}: status=${bookingStatus}, payment_status=${paymentStatus}`);
        return { success: false, reason: 'PAYMENT_NOT_CONFIRMED' };
      }

      // Build target payload
      const payload = this.buildPayload(booking);
      const webhookUrl = this.getWebhookUrl();

      console.log(`📤 [EmailWebhookService] Dispatching payment confirmation email webhook for PNR ${booking.booking_reference} to: ${webhookUrl}`);

      const result = await this.postJson(webhookUrl, payload);
      console.log(`✅ [EmailWebhookService] n8n Webhook successfully accepted confirmation for PNR ${booking.booking_reference} (HTTP ${result.statusCode})`);

      // Record audit log asynchronously
      try {
        await auditService.logEvent({
          userId: booking.user_id,
          action: 'PAYMENT_CONFIRMATION_EMAIL_SENT',
          resourceType: 'BOOKING',
          resourceId: bookingId,
          newValue: {
            pnr: booking.booking_reference,
            customer_email: booking.customer_email,
            webhook_status: result.statusCode
          },
          status: 'SUCCESS'
        });
      } catch (auditErr) {
        // Do not fail if audit logger throws
      }

      return {
        success: true,
        statusCode: result.statusCode,
        payload
      };

    } catch (error) {
      console.error(`❌ [EmailWebhookService] Failed to deliver confirmation webhook for Booking ID ${bookingId}:`, error.message);

      try {
        await auditService.logEvent({
          userId: null,
          action: 'PAYMENT_CONFIRMATION_EMAIL_FAILED',
          resourceType: 'BOOKING',
          resourceId: bookingId,
          newValue: { error: error.message },
          status: 'FAILURE'
        });
      } catch (auditErr) {
        // Ignore audit logging error
      }

      // Return failure info safely without throwing
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new EmailWebhookService();
