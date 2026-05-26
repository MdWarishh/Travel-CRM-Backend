import cron from 'node-cron';
import attendanceService from './attendance.service.js';

/**
 * Auto-Absent Cron Job
 * Runs every day at 11:59 PM server time
 * Marks all active users who didn't check in as ABSENT
 *
 * Schedule: '59 23 * * *'  → 11:59 PM every day
 *
 * To register: import this file in your app.js / server.js
 * Example: import './cron/attendance.cron.js';
 */

cron.schedule('59 23 * * *', async () => {
  console.log('[CRON] Running auto-absent job...');
  try {
    const result = await attendanceService.markAbsentForToday();
    console.log(`[CRON] Auto-absent complete. Marked ${result.marked} users as absent.`);
  } catch (err) {
    console.error('[CRON] Auto-absent job failed:', err.message);
  }
});

console.log('[CRON] Attendance auto-absent job registered (runs at 11:59 PM daily)');