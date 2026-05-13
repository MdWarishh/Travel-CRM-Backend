import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { initIO } from './sockets/index.js';   // ← changed from socket.js
import prisma from './config/db.js';
import { startTaskScheduler } from './modules/tasks/task.scheduler.js';

const PORT = process.env.PORT || 5000;

// ─── Single HTTP server ────────────────────────────────────────
const server = http.createServer(app);

// ─── Initialize Socket.IO (single time) ───────────────────────
// initIO() internally calls initializeSocket() from socket.js AND
// stores the io reference in sockets/index.js so task.service.js
// can access it via emitToUser / getIO without crashing.
const io = initIO(server);

// Attach io so controllers can use req.app.get('io')
app.set('io', io);

startTaskScheduler();

// ─── Start server ──────────────────────────────────────────────
async function main() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV}`);
      console.log(`🌐 CORS origin: ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

main();

// ─── Graceful shutdown ─────────────────────────────────────────
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  console.log('Server shutting down...');
  process.exit(0);
});