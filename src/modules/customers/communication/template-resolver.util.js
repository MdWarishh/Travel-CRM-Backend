// ══════════════════════════════════════════════════════════════════════
// TEMPLATE VARIABLE RESOLVER
// Usage: resolveTemplate(template, { name: 'Rahul', destination: 'Dubai' })
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolves {{variable}} placeholders in a template string.
 * Unknown variables are left as-is so the user sees them in the editor.
 *
 * @param {string} text - Template body with {{variable}} placeholders
 * @param {Record<string, string>} variables - Key-value map of replacements
 * @returns {string} Resolved string
 */
export const resolveTemplate = (text, variables = {}) => {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
};

/**
 * Extract all {{variable}} names from a template string.
 *
 * @param {string} text
 * @returns {string[]} Array of variable names
 */
export const extractVariables = (text) => {
  const matches = text.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
};

/**
 * Build variable map from a customer + booking/itinerary object.
 * Pass whichever objects you have — undefined ones are simply omitted.
 *
 * @param {{ customer?, booking?, itinerary? }}
 * @returns {Record<string, string>}
 */
export const buildVariableMap = ({ customer, booking, itinerary } = {}) => {
  const fmt = (date) =>
    date ? new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return {
    ...(customer && {
      name: customer.name,
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      city: customer.city ?? '',
      country: customer.country ?? '',
    }),
    ...(booking && {
      destination: booking.itinerary?.destination ?? '',
      startDate: fmt(booking.travelStart),
      endDate: fmt(booking.travelEnd),
      totalAmount: booking.totalAmount ? `₹${booking.totalAmount.toLocaleString('en-IN')}` : '',
      advancePaid: booking.advancePaid ? `₹${booking.advancePaid.toLocaleString('en-IN')}` : '',
    }),
    ...(itinerary && {
      destination: itinerary.destination ?? '',
      startDate: fmt(itinerary.startDate),
      endDate: fmt(itinerary.endDate),
      totalPrice: itinerary.totalPrice ? `₹${itinerary.totalPrice.toLocaleString('en-IN')}` : '',
      totalDays: itinerary.totalDays ? String(itinerary.totalDays) : '',
    }),
  };
};