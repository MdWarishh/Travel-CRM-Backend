import bcrypt from 'bcryptjs';
import prisma from '../../config/db.js';
import { generateToken } from '../../utils/jwt.js';
import { AppError } from '../../utils/helpers.js';

// ─── Shared select for user + permissions ─────────────────────────────────────
// Ek jagah define karo — login aur getMe dono use karein
const USER_WITH_PERMISSIONS_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  profileImage: true,
  department: true,
  createdAt: true,
  customRoleId: true,
  customRole: {
    select: {
      id: true,
      name: true,
      permissions: {
        select: {
          module: true,
          action: true,
          allowed: true,
        },
      },
    },
  },
};

// ─── Build permission map from customRole permissions ─────────────────────────
// { "leads:view": true, "bookings:create": false, ... }
const buildPermMap = (customRole) => {
  if (!customRole?.permissions?.length) return {};
  return customRole.permissions.reduce((acc, p) => {
    acc[`${p.module}:${p.action}`] = p.allowed;
    return acc;
  }, {});
};

// ─── Login ────────────────────────────────────────────────────────────────────
const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      ...USER_WITH_PERMISSIONS_SELECT,
      password: true, // sirf login mein chahiye
    },
  });

  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  if (user.status === 'INACTIVE') {
    throw new AppError('Your account has been deactivated. Please contact admin.', 403);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  const token = generateToken({ id: user.id, role: user.role });

  // Password remove karo response se
  const { password: _, ...userWithoutPassword } = user;

  // Permission map build karo — frontend directly use kar sake
  const permissions = buildPermMap(userWithoutPassword.customRole);

  return {
    user: userWithoutPassword,
    permissions, // { "leads:view": true, "bookings:create": false, ... }
    token,
  };
};

// ─── Get Me ───────────────────────────────────────────────────────────────────
const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_WITH_PERMISSIONS_SELECT,
  });

  if (!user) throw new AppError('User not found', 404);

  // Permission map build karo
  const permissions = buildPermMap(user.customRole);

  return { user, permissions };
};

// ─── Change Password ──────────────────────────────────────────────────────────
const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) throw new AppError('Current password is incorrect', 400);

  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  return true;
};

export default {
  login,
  getMe,
  changePassword,
};