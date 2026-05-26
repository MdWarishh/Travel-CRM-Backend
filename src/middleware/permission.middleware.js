import { AppError } from '../utils/helpers.js';

export const requirePermission = (module, action) => {
  return (req, res, next) => {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401);

      // ── 1. ADMIN bypasses everything ──────────────────────────────────────
      if (req.user.role === 'ADMIN') return next();

      // ── 2. Custom role assigned → strictly use permMap only ───────────────
      if (req.user.customRoleId) {
        const key = `${module}:${action}`;
        const allowed = req.user._permMap?.[key];
        if (!allowed) {
          throw new AppError(
            `Access denied. You don't have permission to ${action} ${module}.`,
            403
          );
        }
        return next();
      }

      // ── 3. No custom role → role-based defaults ───────────────────────────

      if (req.user.role === 'MANAGER') return next();

      // AGENT default allowed modules
      const AGENT_ALLOWED_MODULES = [
        'leads', 'customers', 'bookings', 'itinerary',
        'payments', 'tasks', 'chat',
        'flight_tickets', // ✅ Added
      ];
      const AGENT_ALLOWED_ACTIONS = ['view', 'create', 'edit'];

      if (req.user.role === 'AGENT') {
        if (
          AGENT_ALLOWED_MODULES.includes(module) &&
          AGENT_ALLOWED_ACTIONS.includes(action)
        ) {
          return next();
        }
        throw new AppError(`Access denied. Agents cannot ${action} ${module}.`, 403);
      }

      // VENDOR: read-only on bookings
      if (req.user.role === 'VENDOR') {
        if (module === 'bookings' && action === 'view') return next();
        throw new AppError('Access denied.', 403);
      }

      throw new AppError('Access denied.', 403);
    } catch (err) {
      next(err);
    }
  };
};

export const checkPermission = (user, module, action) => {
  if (!user) throw new AppError('Unauthorized', 401);
  if (user.role === 'ADMIN') return true;

  if (user.customRoleId) {
    const key = `${module}:${action}`;
    if (!user._permMap?.[key]) {
      throw new AppError(
        `Access denied. You don't have permission to ${action} ${module}.`,
        403
      );
    }
    return true;
  }

  if (user.role === 'MANAGER') return true;

  const AGENT_ALLOWED_MODULES = [
    'leads', 'customers', 'bookings', 'itinerary',
    'payments', 'tasks', 'chat',
    'flight_tickets', // ✅ Added
  ];
  const AGENT_ALLOWED_ACTIONS = ['view', 'create', 'edit'];

  if (user.role === 'AGENT') {
    if (
      AGENT_ALLOWED_MODULES.includes(module) &&
      AGENT_ALLOWED_ACTIONS.includes(action)
    ) return true;
    throw new AppError(`Access denied. Agents cannot ${action} ${module}.`, 403);
  }

  throw new AppError('Access denied.', 403);
};