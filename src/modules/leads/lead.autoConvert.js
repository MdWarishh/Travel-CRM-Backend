// ─── Auto-convert helper — replaces the old inline prisma.customer.create ─────
// This is the ONLY place auto-conversion happens when a lead hits a Won stage.
// It mirrors exactly what customerService.createCustomerFromLead does so that:
//   1. Activity logs are written (CUSTOMER_CREATED)
//   2. Duplicate phone/email check happens
//   3. Lead.convertedCustomerId is set
//   4. Socket emit fires for ADMIN/MANAGER

import prisma from '../../config/db.js';
import { AppError } from '../../utils/helpers.js';
import { emitToRole, emitToUser } from '../../sockets/index.js';

const sanitize = (data) => JSON.parse(JSON.stringify(data));

// ─── Activity logger (async, non-blocking) ────────────────────────────────────
const logActivity = (leadId, userId, action, description, metadata = null) =>
  prisma.leadActivity
    .create({ data: { leadId, userId, action, description, ...(metadata && { metadata }) } })
    .catch(() => {});

const logCustomerActivity = (customerId, type, title, metadata, performedById) =>
  prisma.customerActivityLog
    .create({
      data: {
        customerId,
        type,
        title,
        metadata: metadata ?? undefined,
        performedById: performedById ?? undefined,
      },
    })
    .catch(() => {});

// ─── Internal auto-convert ────────────────────────────────────────────────────
export const autoConvertLeadToCustomer = async (leadId, lead, requestingUser) => {
  // 1. Already converted? Return existing customer
  if (lead.convertedCustomerId) {
    const existing = await prisma.customer.findUnique({
      where: { id: lead.convertedCustomerId },
    });
    return { lead, customer: existing, alreadyExisted: true };
  }

  // 2. Duplicate check — same phone or email
  const duplicate = await prisma.customer.findFirst({
    where: {
      OR: [
        { phone: lead.phone },
        ...(lead.email ? [{ email: lead.email }] : []),
      ],
    },
  });

  let customer;

  if (duplicate) {
    // Link lead to the existing customer
    await prisma.lead.update({
      where: { id: leadId },
      data: { convertedCustomerId: duplicate.id },
    });
    customer = duplicate;

    logCustomerActivity(
      duplicate.id,
      'CUSTOMER_UPDATED',
      `Lead "${lead.name}" linked to this existing customer profile`,
      { leadId },
      requestingUser?.id
    );
  } else {
    // Create fresh customer
    customer = await prisma.customer.create({
      data: {
        name: lead.name,
        email: lead.email ?? null,
        phone: lead.phone,
        notes: lead.notes ?? null,
        assignedToId: lead.assignedToId ?? requestingUser?.id ?? null,
        tags: [],
      },
    });

    // Link lead → customer
    await prisma.lead.update({
      where: { id: leadId },
      data: { convertedCustomerId: customer.id },
    });

    logCustomerActivity(
      customer.id,
      'CUSTOMER_CREATED',
      `Customer created from Lead: ${lead.name} (Won stage)`,
      { leadId },
      requestingUser?.id
    );
  }

  // 3. Lead activity log
  logActivity(
    leadId,
    requestingUser?.id,
    'converted',
    `Lead auto-converted to customer on Won stage${duplicate ? ' (linked to existing)' : ''}`,
    { customerId: customer.id }
  );

  // 4. Socket emit
  const safe = sanitize({ lead, customer });
  emitToRole('ADMIN', 'lead_converted', safe);
  emitToRole('MANAGER', 'lead_converted', safe);
  if (lead.assignedToId) {
    emitToUser(lead.assignedToId, 'lead_converted', safe);
  }

  return { customer, alreadyExisted: !!duplicate };
};