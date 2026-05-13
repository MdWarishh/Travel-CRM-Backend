import bcrypt from 'bcryptjs';
import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';
import { MODULES, ACTIONS } from './user.validation.js';

// ─── Field Selectors ──────────────────────────────────────────────────────────

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  profileImage: true,
  department: true,
  lastLogin: true,
  customRoleId: true,   // ✅ permission check ke liye frontend ko chahiye
  createdAt: true,
  updatedAt: true,
};

const userDetailSelect = {
  ...userSelect,
  _count: {
    select: {
      assignedLeads: true,
      assignedCustomers: true,
      assignedTasks: true,
    },
  },
};

// ─── Helper: Log User Activity ────────────────────────────────────────────────

export const logActivity = async ({ userId, action, module, entity, entityId, metadata, ipAddress }) => {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        action,
        entity: module || entity || 'system',
        entityId,
        metadata: {
          ...(metadata || {}),
          ...(ipAddress && { ipAddress }),
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (_) {
    // Non-blocking — never throw from logger
  }
};

// ─── Helper: Build Default Permissions for a Role ────────────────────────────

const buildDefaultPermissions = (roleName) => {
  const permissions = [];

  const permissionMatrix = {
    ADMIN: {
      // Admin gets everything
      dashboard: ['view'],
      leads: ['view', 'create', 'edit', 'delete'],
      customers: ['view', 'create', 'edit', 'delete'],
      itinerary: ['view', 'create', 'edit', 'delete'],
      bookings: ['view', 'create', 'edit', 'delete'],
      payments: ['view', 'create', 'edit', 'delete'],
      tasks: ['view', 'create', 'edit', 'delete'],
      users: ['view', 'create', 'edit', 'delete'],
      reports: ['view', 'create', 'edit', 'delete'],
      attendance: ['view', 'create', 'edit', 'delete'],
      chat: ['view', 'create', 'edit', 'delete'],
      vendors: ['view', 'create', 'edit', 'delete'],
    },
    MANAGER: {
      dashboard: ['view'],
      leads: ['view', 'create', 'edit'],
      customers: ['view', 'create', 'edit'],
      itinerary: ['view', 'create', 'edit'],
      bookings: ['view', 'create', 'edit'],
      payments: ['view', 'create'],
      tasks: ['view', 'create', 'edit', 'delete'],
      users: ['view'],
      reports: ['view'],
      attendance: ['view'],
      chat: ['view', 'create'],
      vendors: ['view', 'create', 'edit'],
    },
    AGENT: {
      dashboard: ['view'],
      leads: ['view', 'create', 'edit'],
      customers: ['view', 'create', 'edit'],
      itinerary: ['view', 'create', 'edit'],
      bookings: ['view', 'create'],
      payments: ['view'],
      tasks: ['view', 'create', 'edit'],
      users: [],
      reports: [],
      attendance: ['view'],
      chat: ['view', 'create'],
      vendors: ['view'],
    },
    VENDOR: {
      dashboard: ['view'],
      leads: [],
      customers: [],
      itinerary: ['view'],
      bookings: ['view'],
      payments: ['view'],
      tasks: ['view'],
      users: [],
      reports: [],
      attendance: [],
      chat: ['view', 'create'],
      vendors: [],
    },
  };

  const rolePerms = permissionMatrix[roleName] || {};

  for (const module of MODULES) {
    const allowedActions = rolePerms[module] || [];
    for (const action of ACTIONS) {
      permissions.push({
        module,
        action,
        allowed: allowedActions.includes(action),
      });
    }
  }

  return permissions;
};

// ═════════════════════════════════════════════════════════════════════════════
// USER CRUD
// ═════════════════════════════════════════════════════════════════════════════

export const getAllUsers = async ({ page, limit, role, status, search, department, sortBy = 'createdAt', sortOrder = 'desc' }) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(role && { role }),
    ...(status && { status }),
    ...(department && { department: { contains: department, mode: 'insensitive' } }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userDetailSelect,
      skip,
      take,
      orderBy: { [sortBy]: sortOrder },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

export const getUserById = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: userDetailSelect,
  });

  if (!user) throw new AppError('User not found', 404);
  return user;
};

export const createUser = async (data, createdByUserId) => {
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) throw new AppError('A user with this email already exists', 409);

  const hashed = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: { ...data, password: hashed },
    select: userSelect,
  });

  await logActivity({
    userId: createdByUserId,
    action: 'create',
    entity: 'users',
    entityId: user.id,
    metadata: { targetUserEmail: user.email, targetUserRole: user.role },
  });

  return user;
};

export const updateUser = async (id, data, updatedByUserId) => {
  await getUserById(id); // 404 check

  if (data.email) {
    const existing = await prisma.user.findFirst({
      where: { email: data.email, NOT: { id } },
    });
    if (existing) throw new AppError('This email is already in use by another user', 409);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: userSelect,
  });

  await logActivity({
    userId: updatedByUserId,
    action: 'edit',
    entity: 'users',
    entityId: id,
    metadata: { updatedFields: Object.keys(data) },
  });

  return user;
};

export const toggleUserStatus = async (id, actorId) => {
  const user = await getUserById(id);

  // Prevent self-deactivation
  if (id === actorId) throw new AppError('You cannot change your own status', 403);

  const newStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const updated = await prisma.user.update({
    where: { id },
    data: { status: newStatus },
    select: userSelect,
  });

  await logActivity({
    userId: actorId,
    action: newStatus === 'ACTIVE' ? 'activate' : 'deactivate',
    entity: 'users',
    entityId: id,
    metadata: { previousStatus: user.status, newStatus },
  });

  return updated;
};

export const deleteUser = async (id, actorId) => {
  if (id === actorId) throw new AppError('You cannot delete your own account', 403);

  const user = await getUserById(id);

  // Check if user has active assignments
  const [leadCount, customerCount] = await Promise.all([
    prisma.lead.count({ where: { assignedToId: id } }),
    prisma.customer.count({ where: { assignedToId: id } }),
  ]);

  if (leadCount > 0 || customerCount > 0) {
    throw new AppError(
      `Cannot delete user. They have ${leadCount} leads and ${customerCount} customers assigned. Please reassign first.`,
      409
    );
  }

  await prisma.user.delete({ where: { id } });

  await logActivity({
    userId: actorId,
    action: 'delete',
    entity: 'users',
    entityId: id,
    metadata: { deletedUserEmail: user.email, deletedUserRole: user.role },
  });

  return true;
};

export const changePassword = async (id, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) throw new AppError('Current password is incorrect', 401);

  const hashed = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id },
    data: { password: hashed },
  });

  await logActivity({
    userId: id,
    action: 'password_change',
    entity: 'users',
    entityId: id,
  });

  return true;
};

export const updateLastLogin = async (userId, ipAddress) => {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLogin: new Date() },
    });
    await logActivity({
      userId,
      action: 'login',
      entity: 'users',
      entityId: userId,
      metadata: { ipAddress },
    });
  } catch (_) {
    // Non-blocking
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ROLES
// ═════════════════════════════════════════════════════════════════════════════

export const getAllRoles = async () => {
  const roles = await prisma.customRole.findMany({
    include: {
      permissions: true,
      _count: { select: { users: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return roles;
};

export const getRoleById = async (id) => {
  const role = await prisma.customRole.findUnique({
    where: { id },
    include: {
      permissions: { orderBy: [{ module: 'asc' }, { action: 'asc' }] },
      _count: { select: { users: true } },
    },
  });
  if (!role) throw new AppError('Role not found', 404);
  return role;
};

export const createCustomRole = async (data, createdByUserId) => {
  const exists = await prisma.customRole.findFirst({
    where: { name: { equals: data.name, mode: 'insensitive' } },
  });
  if (exists) throw new AppError('A role with this name already exists', 409);

  const role = await prisma.customRole.create({
    data: {
      name: data.name,
      description: data.description,
      permissions: {
        create: data.permissions.length > 0
          ? data.permissions
          : buildDefaultPermissions('AGENT'), // Default to AGENT-like permissions
      },
    },
    include: { permissions: true },
  });

  await logActivity({
    userId: createdByUserId,
    action: 'create_role',
    entity: 'users',
    entityId: role.id,
    metadata: { roleName: role.name },
  });

  return role;
};

export const updateCustomRole = async (id, data, updatedByUserId) => {
  await getRoleById(id);

  if (data.name) {
    const existing = await prisma.customRole.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, NOT: { id } },
    });
    if (existing) throw new AppError('A role with this name already exists', 409);
  }

  const role = await prisma.customRole.update({
    where: { id },
    data: { name: data.name, description: data.description },
    include: { permissions: true },
  });

  await logActivity({
    userId: updatedByUserId,
    action: 'edit_role',
    entity: 'users',
    entityId: id,
    metadata: { updatedFields: Object.keys(data) },
  });

  return role;
};

export const deleteCustomRole = async (id, actorId) => {
  const role = await getRoleById(id);

  if (role._count.users > 0) {
    throw new AppError(
      `Cannot delete role "${role.name}" — it is assigned to ${role._count.users} user(s). Reassign them first.`,
      409
    );
  }

  await prisma.customRole.delete({ where: { id } });

  await logActivity({
    userId: actorId,
    action: 'delete_role',
    entity: 'users',
    entityId: id,
    metadata: { roleName: role.name },
  });

  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// PERMISSIONS
// ═════════════════════════════════════════════════════════════════════════════

export const updateRolePermissions = async (roleId, permissions, actorId) => {
  await getRoleById(roleId); // 404 check

  // Upsert all permissions in a transaction
  await prisma.$transaction(
    permissions.map(({ module, action, allowed }) =>
      prisma.rolePermission.upsert({
        where: { roleId_module_action: { roleId, module, action } },
        update: { allowed },
        create: { roleId, module, action, allowed },
      })
    )
  );

  await logActivity({
    userId: actorId,
    action: 'update_permissions',
    entity: 'users',
    entityId: roleId,
    metadata: { updatedCount: permissions.length },
  });

  return getRoleById(roleId);
};

export const getUserPermissions = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, customRoleId: true },
  });

  if (!user) throw new AppError('User not found', 404);

  // If user has a custom role, fetch those permissions
  if (user.customRoleId) {
    const role = await prisma.customRole.findUnique({
      where: { id: user.customRoleId },
      include: { permissions: true },
    });
    return role?.permissions || [];
  }

  // Otherwise return system role default permissions
  return buildDefaultPermissions(user.role);
};

export const hasPermission = async (userId, module, action) => {
  const permissions = await getUserPermissions(userId);
  const perm = permissions.find((p) => p.module === module && p.action === action);
  return perm?.allowed === true;
};

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITY LOGS
// ═════════════════════════════════════════════════════════════════════════════

export const getActivityLogs = async ({ page, limit, userId, action, module, startDate, endDate }) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(userId && { userId }),
    ...(action && { action: { contains: action, mode: 'insensitive' } }),
    ...(module && { entity: module }),
    ...((startDate || endDate) && {
      createdAt: {
        ...(startDate && { gte: startDate }),
        ...(endDate && { lte: endDate }),
      },
    }),
  };

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true, profileImage: true } },
      },
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return { logs, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS (for admin users page)
// ═════════════════════════════════════════════════════════════════════════════

export const getUserStats = async () => {
  const [total, byRole, byStatus, recentLogins] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['role'], _count: { id: true } }),
    prisma.user.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.user.count({
      where: {
        lastLogin: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return {
    total,
    active: byStatus.find((s) => s.status === 'ACTIVE')?._count.id || 0,
    inactive: byStatus.find((s) => s.status === 'INACTIVE')?._count.id || 0,
    byRole: Object.fromEntries(byRole.map((r) => [r.role, r._count.id])),
    activeInLast7Days: recentLogins,
  };
};