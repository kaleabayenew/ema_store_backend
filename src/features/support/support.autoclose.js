const { pool } = require('../../core/config/database');

/**
 * Auto-close job: Closes tickets that have been inactive for 30 minutes
 * Runs every 5 minutes to check for inactive tickets
 */
const AUTO_CLOSE_MINUTES = 30;
const CHECK_INTERVAL_MINUTES = 5;

async function autoCloseInactiveTickets() {
  try {
    const { rows } = await pool.query(
      `UPDATE support_tickets
       SET status = 'CLOSED',
           updated_at = NOW()
       WHERE status IN ('OPEN', 'IN_PROGRESS')
         AND updated_at < NOW() - ($1 || ' minutes')::interval
       RETURNING id, subject, status`,
      [AUTO_CLOSE_MINUTES]
    );

    if (rows.length > 0) {
      console.log(`[Auto-Close] Closed ${rows.length} inactive ticket(s):`, rows.map(r => r.id));
    }
  } catch (error) {
    console.error('[Auto-Close] Error:', error);
  }
}

/**
 * Start the auto-close job interval
 * @returns {NodeJS.Timeout} Interval ID (for testing/cleanup)
 */
function startAutoCloseJob() {
  console.log(`[Auto-Close] Starting job - closes tickets inactive for ${AUTO_CLOSE_MINUTES} minutes, checks every ${CHECK_INTERVAL_MINUTES} minutes`);
  
  // Run immediately on start
  autoCloseInactiveTickets();
  
  // Then run periodically
  const intervalId = setInterval(autoCloseInactiveTickets, CHECK_INTERVAL_MINUTES * 60 * 1000);
  return intervalId;
}

module.exports = {
  autoCloseInactiveTickets,
  startAutoCloseJob,
};
