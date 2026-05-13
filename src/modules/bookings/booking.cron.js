/**
 * booking.cron.js
 * 
 * Daily cron job — runs at 8:00 AM
 * - Updates trip statuses (UPCOMING → ONGOING → COMPLETED)
 * - Sends WhatsApp messages for ongoing trips
 * 
 * Setup in your main app.js:
 *   import './modules/bookings/booking.cron.js';
 */

import cron from 'node-cron';
import { updateAllTripStatuses, getWhatsappMessage } from './booking.service.js';
import prisma from '../../config/db.js';

// ─── Daily 8 AM job ───────────────────────────
cron.schedule('0 8 * * *', async () => {
  console.log('[CRON] Running daily booking status update...');

  try {
    // 1. Update all trip statuses
    const updated = await updateAllTripStatuses();
    console.log(`[CRON] Updated ${updated} booking statuses`);

    // 2. Find all ONGOING bookings
    const ongoingBookings = await prisma.booking.findMany({
      where: { tripStatus: 'ONGOING', status: { notIn: ['CANCELLED'] } },
      include: {
        customer: { select: { name: true, phone: true } },
        days: { orderBy: { dayNumber: 'asc' } },
        transportBookings: { take: 1 },
      },
    });

    console.log(`[CRON] ${ongoingBookings.length} ongoing bookings found`);

    for (const booking of ongoingBookings) {
      try {
        const today = new Date();
        const start = booking.travelStart ? new Date(booking.travelStart) : null;
        if (!start) continue;

        const daysDiff = Math.floor((today - start) / 86400000);
        const dayNum = daysDiff + 1;
        const totalDays = booking.totalDays ?? 1;

        // Determine message type
        let type = 'DAILY';
        if (dayNum === 1) type = 'TRIP_START';
        if (dayNum === totalDays) type = 'FINAL_DAY';

        const { message, phone, whatsappUrl } = await getWhatsappMessage(booking.id, type);

        // Log it — agent can see it in timeline and click to send
        await prisma.bookingLog.create({
          data: {
            bookingId: booking.id,
            message: `📱 WhatsApp ready for Day ${dayNum} (${type}): ${whatsappUrl}`,
            type: 'SYSTEM',
          },
        });

        console.log(`[CRON] WhatsApp prepared for booking ${booking.id} — Day ${dayNum}`);
      } catch (err) {
        console.error(`[CRON] Error for booking ${booking.id}:`, err.message);
      }
    }

    // 3. Post-trip messages — 1 day after completion
    const completedYesterday = await prisma.booking.findMany({
      where: {
        tripStatus: 'COMPLETED',
        travelEnd: {
          gte: new Date(Date.now() - 2 * 86400000),
          lte: new Date(Date.now() - 86400000),
        },
      },
    });

    for (const booking of completedYesterday) {
      await prisma.bookingLog.create({
        data: {
          bookingId: booking.id,
          message: `📱 Post-trip WhatsApp ready — send feedback request`,
          type: 'SYSTEM',
        },
      });
    }

    console.log('[CRON] Daily booking job complete ✓');
  } catch (err) {
    console.error('[CRON] Daily booking job failed:', err);
  }
}, {
  timezone: 'Asia/Kolkata',
});

console.log('[CRON] Booking cron job registered — runs daily at 8:00 AM IST');