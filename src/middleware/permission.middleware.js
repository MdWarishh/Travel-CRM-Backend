import { AppError } from '../utils/helpers.js';

/**
 * requirePermission middleware
 *
 * Usage:
 *   router.get('/leads', requirePermission('leads', 'view'), controller)
 *
 * - ADMIN always bypasses
 * - MANAGER & AGENT use their CustomRole permission matrix
 * - If user has no CustomRole → falls back to basic role defaults:
 *     MANAGER: view + create + edit on all modules
 *     AGENT:   view + create + edit on leads/customers/bookings only
 * - Permission map is built in authenticate() middleware — NO extra DB query here
 */
export const requirePermission = (module, action) => {
  return (req, res, next) => {
    try {
      if (!req.user) throw new AppError('Unauthorized', 401);

      // ADMIN bypasses everything
      if (req.user.role === 'ADMIN') return next();

      // If user has a custom role with permissions loaded
      if (req.user.customRoleId && req.user._permMap) {
        const key = `${module}:${action}`;
        const allowed = req.user._permMap[key];

        if (!allowed) {
          throw new AppError(
            `Access denied. You don't have permission to ${action} ${module}.`,
            403
          );
        }

        return next();
      }

      // ── Fallback defaults for users without a CustomRole ──────────────────
      // MANAGER: full access to everything (except user management)
      if (req.user.role === 'MANAGER') return next();

      // AGENT: can view/create/edit leads, customers, bookings, itinerary, payments, tasks
      const AGENT_ALLOWED_MODULES = ['leads', 'customers', 'bookings', 'itinerary', 'payments', 'tasks', 'chat'];
      const AGENT_ALLOWED_ACTIONS = ['view', 'create', 'edit'];

      if (req.user.role === 'AGENT') {
        if (AGENT_ALLOWED_MODULES.includes(module) && AGENT_ALLOWED_ACTIONS.includes(action)) {
          return next();
        }
        throw new AppError(
          `Access denied. Agents cannot ${action} ${module}.`,
          403
        );
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

/**
 * checkPermission — inline helper for services/controllers
 * Fast: reads from in-memory _permMap, no DB call
 */
export const checkPermission = (user, module, action) => {
  if (!user) throw new AppError('Unauthorized', 401);
  if (user.role === 'ADMIN') return true;
  if (user.role === 'MANAGER') return true;

  if (user.customRoleId && user._permMap) {
    const key = `${module}:${action}`;
    if (!user._permMap[key]) {
      throw new AppError(`Access denied. You don't have permission to ${action} ${module}.`, 403);
    }
    return true;
  }

  const AGENT_ALLOWED_MODULES = ['leads', 'customers', 'bookings', 'itinerary', 'payments', 'tasks', 'chat'];
  const AGENT_ALLOWED_ACTIONS = ['view', 'create', 'edit'];

  if (user.role === 'AGENT') {
    if (AGENT_ALLOWED_MODULES.includes(module) && AGENT_ALLOWED_ACTIONS.includes(action)) return true;
    throw new AppError(`Access denied. Agents cannot ${action} ${module}.`, 403);
  }

  throw new AppError('Access denied.', 403);
};