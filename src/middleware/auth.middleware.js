import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';

// ─── Authenticate ─────────────────────────────────────────────────────────────
export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user + their custom role permissions in ONE query
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        profileImage: true,
        customRoleId: true,
        customRole: {
          select: {
            id: true,
            name: true,
            permissions: {
              select: { module: true, action: true, allowed: true },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    if (user.status === 'INACTIVE') {
      return res.status(403).json({ success: false, message: 'Account is inactive.' });
    }

    // Build permission map for fast O(1) checks: { "leads:view": true, "bookings:create": false, ... }
    if (user.customRole?.permissions) {
      user._permMap = user.customRole.permissions.reduce((acc, p) => {
        acc[`${p.module}:${p.action}`] = p.allowed;
        return acc;
      }, {});
    } else {
      user._permMap = {};
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

// ─── Authorize (role-based) ───────────────────────────────────────────────────
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}.`,
      });
    }

    next();
  };
};

// ─── Socket.IO auth middleware ────────────────────────────────────────────────
export const verifySocketToken = async (socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(' ')[1];

  if (!token) {
    return next(new Error('Socket authentication error: No token'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, name: true, email: true, role: true, status: true },
    });

    if (!user || user.status === 'INACTIVE') {
      return next(new Error('Socket authentication error: Invalid user'));
    }

    socket.user = user;
    next();
  } catch (error) {
    return next(new Error('Socket authentication error: Invalid token'));
  }
};