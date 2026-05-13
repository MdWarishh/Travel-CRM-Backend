// ─────────────────────────────────────────────────────────────────────────────
// task.scheduler.js
// Place this file at: src/modules/tasks/task.scheduler.js
//
// USAGE — add this to your main app.js / server.js:
//
//   import { startTaskScheduler } from './modules/tasks/task.scheduler.js';
//   startTaskScheduler();
//
// ─────────────────────────────────────────────────────────────────────────────

import cron from 'node-cron';
import { runReminderJob } from './task.service.js';

export const startTaskScheduler = () => {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      await runReminderJob();
    } catch (err) {
      console.error('❌ Task scheduler error:', err.message);
    }
  });

  console.log('✅ Task reminder scheduler started (runs every minute)');
};