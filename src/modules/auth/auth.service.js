import bcrypt from 'bcryptjs';
import prisma from '../../config/db.js';
import { generateToken } from '../../utils/jwt.js';
import { AppError } from '../../utils/helpers.js';

const login = async ({ email, password }) => {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      profileImage: true,
      department: true,
      password: true,
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

  // Remove password from response
  const { password: _, ...userWithoutPassword } = user;

  return { user: userWithoutPassword, token };
};

const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      profileImage: true,
      department: true,
      createdAt: true,
    },
  });

  if (!user) throw new AppError('User not found', 404);
  return user;
};

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