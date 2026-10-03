const disruptionRepository = require('../repositories/disruptionRepository');

class DisruptionNotificationWorker {
  /**
   * Process pending notification queue out of transaction
   */
  async processPendingNotifications(limit = 20) {
    const webhook = process.env.DISRUPTION_NOTIFICATION_WEBHOOK_URL;
    if (process.env.NOTIFICATIONS_ENABLED !== 'true' || !webhook || process.env.NODE_ENV === 'test') {
      return { processed: 0, sent: 0, failed: 0, disabled: true };
    }
    try {
      const pendingItems = await disruptionRepository.getPendingNotifications(null, limit);
      if (pendingItems.length === 0) return { processed: 0, sent: 0, failed: 0 };

      let sentCount = 0;
      let failedCount = 0;

      for (const item of pendingItems) {
        try {
          await require('../services/emailWebhookService').postJson(webhook, {
            notification_id: item.affected_id, email: item.user_email, first_name: item.first_name,
            flight_number: item.flight_number, disruption_type: item.disruption_type, reason: item.reason
          });
          await disruptionRepository.updateNotificationStatus(null, item.affected_id, 'SENT');
          sentCount++;
        } catch (err) {
          await disruptionRepository.updateNotificationStatus(null, item.affected_id, 'FAILED', err.message);
          failedCount++;
        }
      }

      return {
        processed: pendingItems.length,
        sent: sentCount,
        failed: failedCount
      };
    } catch (err) {
      console.error('DisruptionNotificationWorker error:', err.message);
      return { processed: 0, sent: 0, failed: 0, error: err.message };
    }
  }
}

module.exports = new DisruptionNotificationWorker();
