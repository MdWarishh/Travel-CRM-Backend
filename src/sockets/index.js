// ─────────────────────────────────────────────────────────────────────────────
// sockets/index.js
//
// Previously this file had its OWN `let io` variable that was never initialized
// because server.js calls initializeSocket() from socket.js — not this file.
//
// Fix: delegate everything to socket.js so there is ONE source of truth for `io`.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeSocket } from './socket.js';

// Re-export initializeSocket so any old import of initSocket still works
export { initializeSocket as initSocket };

// ── Get the live `io` instance from socket.js ─────────────────────────────────
// socket.js does NOT export getIO, so we keep a local reference that gets
// populated the first time initializeSocket() is called (in server.js).
let _io = null;

// Monkey-patch: wrap initializeSocket so we capture the returned io here too.
// This means as long as server.js calls initializeSocket(server), _io is set.
const _originalInit = initializeSocket;

// Override export so server.js can keep using it unchanged
export const initIO = (server) => {
  _io = _originalInit(server);
  return _io;
};

export const getIO = () => {
  if (!_io) {
    // Soft fail — log warning but don't crash the request
    console.warn('⚠️  Socket.IO not initialized — real-time emit skipped');
    return null;
  }
  return _io;
};

// ── Emit helpers ──────────────────────────────────────────────────────────────

export const emitToUser = (userId, event, data) => {
  const io = getIO();
  if (!io) return;   // silently skip if socket not ready
  io.to(`user:${userId}`).emit(event, data);
};

export const emitToRole = (role, event, data) => {
  const io = getIO();
  if (!io) return;
  io.to(`role:${role}`).emit(event, data);
};

export const emitToAll = (event, data) => {
  const io = getIO();
  if (!io) return;
  io.emit(event, data);
};