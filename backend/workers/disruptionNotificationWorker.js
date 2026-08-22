const disruptionRepository = require('../repositories/disruptionRepository');

class DisruptionNotificationWorker {
  /**
   * Process pending notification queue out of transaction
   */
  async processPendingNotifications(limit = 20) {
    try {
      const pendingItems = await disruptionRepository.getPendingNotifications(null, limit);
      if (pendingItems.length === 0) return { processed: 0, sent: 0, failed: 0 };

      let sentCount = 0;
      let failedCount = 0;

      for (const item of pendingItems) {
        try {
          // Simulate email/SMS notification dispatch
          const mockSuccess = true; // Simulating email dispatch success
          if (mockSuccess) {
            await disruptionRepository.updateNotificationStatus(null, item.affected_id, 'SENT');
            sentCount++;
          } else {
            throw new Error('Notification gateway unreachable');
          }
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
