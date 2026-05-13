export const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err);

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'A record with this value already exists.',
      field: err.meta?.target,
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found.',
    });
  }

  // Zod validation errors (SAFE)
  if (err.name === 'ZodError') {
    const formattedErrors = Array.isArray(err.errors)
      ? err.errors.map((e) => ({
          field: e.path?.join('.') || 'unknown',
          message: e.message,
        }))
      : [];

    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: formattedErrors,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired.' });
  }

  // 🔥 Handle unknown structured errors (IMPORTANT)
  if (err?.errors && typeof err.errors === 'object') {
    return res.status(400).json({
      success: false,
      message: err.message || 'Validation failed',
      errors: Object.values(err.errors).map((e) => ({
        message: e.message || e,
      })),
    });
  }

  // Generic fallback
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};