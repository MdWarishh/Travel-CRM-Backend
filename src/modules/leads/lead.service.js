import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';
import { emitToRole, emitToUser } from '../../sockets/index.js';
import * as XLSX from 'xlsx';
import { autoConvertLeadToCustomer } from './lead.autoConvert.js';

const sanitize = (data) => JSON.parse(JSON.stringify(data));

// ─── Auto-increment number generator ─────────────────────────────────────────
const generateNumber = async (model, field, prefix) => {
  const last = await prisma[model].findFirst({ orderBy: { createdAt: 'desc' } });
  if (!last) return `${prefix}-0001`;
  const lastNum = parseInt(last[field].split('-')[1] || '0', 10);
  return `${prefix}-${String(lastNum + 1).padStart(4, '0')}`;
};

// ─── leadInclude — lightweight version for pipeline ───────────────────────────
const pipelineLeadInclude = {
  assignedTo: { select: { id: true, name: true } },
  followUps: { where: { status: 'PENDING' }, orderBy: { dueAt: 'asc' }, take: 3, select: { id: true, dueAt: true, type: true } },
  labels: { include: { label: { select: { id: true, name: true, color: true } } } },
};

// ─── leadInclude — full version for detail view ───────────────────────────────
const leadInclude = {
  stage: true,
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  leadNotes: { orderBy: { createdAt: 'desc' } },
  followUps: {
    where: { status: 'PENDING' },
    orderBy: { dueAt: 'asc' },
    take: 3,
  },
  labels: { include: { label: true } },
};

// ─── Activity logger ──────────────────────────────────────────────────────────
const logActivity = async (leadId, userId, action, description, metadata = null) => {
  await prisma.leadActivity.create({
    data: { leadId, userId, action, description, ...(metadata && { metadata }) },
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// LEADS — CRUD
// ═════════════════════════════════════════════════════════════════════════════

export const getAllLeads = async ({ page, limit, status, priority, source, assignedToId, search }, requestingUser) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(priority && { priority }),
    ...(source && { source }),
    ...(requestingUser.role === 'AGENT' && { assignedToId: requestingUser.id }),
    ...(assignedToId && requestingUser.role !== 'AGENT' && { assignedToId }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { destination: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({ where, include: leadInclude, skip, take, orderBy: { createdAt: 'desc' } }),
    prisma.lead.count({ where }),
  ]);

  return { leads, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

export const getLeadById = async (id, requestingUser) => {
  const lead = await prisma.lead.findUnique({ where: { id }, include: leadInclude });
  if (!lead) throw new AppError('Lead not found', 404);

  if (requestingUser.role === 'AGENT' && lead.assignedToId !== requestingUser.id)
    throw new AppError('Access denied', 403);

  return lead;
};

export const createLead = async (data, requestingUser) => {
  if (requestingUser.role === 'AGENT') data.assignedToId = requestingUser.id;

  // Get default stage in parallel is fine — single query
  const defaultStage = await prisma.leadStage.findFirst({ orderBy: { position: 'asc' } });

  const lead = await prisma.lead.create({
    data: {
      name: data.name,
      ...(data.email && { email: data.email }),
      phone: data.phone,
      source: data.source || 'MANUAL',
      priority: data.priority || 'WARM',
      rating: data.rating ?? 0,
      ...(data.destination && { destination: data.destination }),
      ...(data.estimatedBudget && { estimatedBudget: data.estimatedBudget }),
      ...(data.travelDate && { travelDate: new Date(data.travelDate) }),
      ...(data.numberOfTravelers && { numberOfTravelers: data.numberOfTravelers }),
      ...(data.notes && { notes: data.notes }),
      ...(data.assignedToId && { assignedToId: data.assignedToId }),
      stageId: data.stageId || (defaultStage ? defaultStage.id : undefined),
    },
    include: leadInclude,
  });

  // Fire activity log async — don't await, don't block response
  logActivity(lead.id, requestingUser.id, 'created', 'Lead created').catch(() => {});

  const safe = sanitize(lead);
  emitToRole('ADMIN', 'new_lead', { lead: safe });
  emitToRole('MANAGER', 'new_lead', { lead: safe });
  if (lead.assignedToId) emitToUser(lead.assignedToId, 'lead_assigned', { lead: safe });

  return lead;
};

export const updateLead = async (id, data, requestingUser) => {
  // Single query — don't call getLeadById which does a full include
  const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);
  if (requestingUser.role === 'AGENT' && existing.assignedToId !== requestingUser.id)
    throw new AppError('Access denied', 403);

  if (data.travelDate) data.travelDate = new Date(data.travelDate);
  if (data.rating !== undefined) data.rating = Math.min(5, Math.max(0, parseInt(data.rating)));

  const updated = await prisma.lead.update({ where: { id }, data, include: leadInclude });

  // Async activity log
  logActivity(id, requestingUser.id, 'updated', 'Lead details updated').catch(() => {});

  if (data.assignedToId && data.assignedToId !== existing.assignedToId)
    emitToUser(data.assignedToId, 'lead_assigned', { lead: sanitize(updated) });

  return updated;
};

export const deleteLead = async (id, requestingUser) => {
  // Minimal query — just check existence + ownership
  const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);
  if (requestingUser.role === 'AGENT' && existing.assignedToId !== requestingUser.id)
    throw new AppError('Access denied', 403);

  await prisma.lead.delete({ where: { id } });
  return true;
};

export const assignLead = async (leadId, assignedToId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  const agent = await prisma.user.findFirst({
    where: { id: assignedToId, role: { in: ['AGENT', 'MANAGER'] } },
    select: { id: true, name: true },
  });
  if (!agent) throw new AppError('Agent not found', 404);

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { assignedToId },
    include: leadInclude,
  });

  logActivity(leadId, requestingUser.id, 'assigned', `Lead assigned to ${agent.name}`).catch(() => {});
  emitToUser(assignedToId, 'lead_assigned', { lead: sanitize(updated) });
  return updated;
};

// ─── Rating Update ────────────────────────────────────────────────────────────
export const updateLeadRating = async (leadId, rating, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);
  if (requestingUser.role === 'AGENT' && existing.assignedToId !== requestingUser.id)
    throw new AppError('Access denied', 403);

  const clampedRating = Math.min(5, Math.max(0, parseInt(rating)));
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { rating: clampedRating },
    select: { id: true, rating: true },
  });

  logActivity(leadId, requestingUser.id, 'rating_updated', `Rating updated to ${clampedRating}`).catch(() => {});
  return updated;
};

// ─── Change Stage — with auto-convert on "Won" stage ─────────────────────────
export const changeLeadStage = async (leadId, stageId, requestingUser) => {
  // Parallel: check lead + check stage simultaneously
  const [existing, stage] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
     select: { id: true, name: true, email: true, phone: true, notes: true, assignedToId: true, stageId: true, convertedCustomerId: true },
    }),
    prisma.leadStage.findUnique({ where: { id: stageId }, select: { id: true, title: true, color: true, isWon: true } }),
  ]);

  if (!existing) throw new AppError('Lead not found', 404);
  if (requestingUser.role === 'AGENT' && existing.assignedToId !== requestingUser.id)
    throw new AppError('Access denied', 403);
  if (!stage) throw new AppError('Stage not found', 404);

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { stageId },
    include: leadInclude,
  });

  logActivity(leadId, requestingUser.id, 'stage_changed',
    `Stage changed to ${stage.title}`,
    { fromStageId: existing.stageId, toStageId: stageId }
  ).catch(() => {});

  const safeData = sanitize({ lead: updated, stage });
  emitToRole('ADMIN', 'lead_stage_changed', safeData);
  emitToRole('MANAGER', 'lead_stage_changed', safeData);
  if (updated.assignedToId) emitToUser(updated.assignedToId, 'lead_stage_changed', sanitize({ lead: updated }));

  // ── Auto-convert on "Won" stage ───────────────────────────────────────────
 if (stage.isWon && !existing.convertedCustomerId) {
  try {
    const { customer, alreadyExisted } = await autoConvertLeadToCustomer(
      leadId,
      existing,   // ← updated ki jagah existing pass karo (phone/email/notes sab hai isme)
      requestingUser
    );
    return {
      lead: updated,          // ← updated lead (already fetched above)
      customer,
      autoConverted: true,
      alreadyExisted,
    };
  } catch (err) {
    console.error('[changeLeadStage] Auto-convert failed:', err.message);
    // Stage change succeed hua hai — sirf conversion fail hua
    // Return normally without crashing
  }
}
 
return updated;
};

// ─── Internal auto-convert helper ────────────────────────────────────────────
const autoConvertToCustomer = async (leadId, lead, requestingUser) => {
  const customer = await prisma.customer.create({
    data: {
      name: lead.name,
      ...(lead.email && { email: lead.email }),
      phone: lead.phone,
      ...(lead.assignedToId && { assignedToId: lead.assignedToId }),
      ...(lead.notes && { notes: lead.notes }),
    },
  });

  const updatedLead = await prisma.lead.update({
    where: { id: leadId },
    data: { convertedCustomerId: customer.id },
    include: leadInclude,
  });

  logActivity(leadId, requestingUser.id, 'converted', 'Lead auto-converted to customer on Won stage').catch(() => {});

  const safe = sanitize({ lead: updatedLead, customer });
  emitToRole('ADMIN', 'lead_converted', safe);
  emitToRole('MANAGER', 'lead_converted', safe);

  return { lead: updatedLead, customer };
};
export const convertToCustomer = async (leadId, requestingUser) => {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, name: true, email: true, phone: true,
      notes: true, assignedToId: true, convertedCustomerId: true,
    },
  });
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.convertedCustomerId) throw new AppError('Lead already converted to a customer', 400);
 
  const { customer, alreadyExisted } = await autoConvertLeadToCustomer(
    leadId,
    lead,
    requestingUser
  );
 
  const updatedLead = await prisma.lead.findUnique({ where: { id: leadId }, include: leadInclude });
 
  return { lead: updatedLead, customer, alreadyExisted };
};

// ─── Pipeline — FIXED: single groupBy query instead of N+1 ───────────────────
export const getLeadPipeline = async (requestingUser) => {
  const leadWhere = requestingUser.role === 'AGENT' ? { assignedToId: requestingUser.id } : {};

  // Fetch stages + all leads in parallel — 2 queries total instead of 2N
  const [stages, allLeads] = await Promise.all([
    prisma.leadStage.findMany({ orderBy: { position: 'asc' } }),
    prisma.lead.findMany({
      where: leadWhere,
      select: {
        id: true, name: true, phone: true, email: true,
        source: true, priority: true, rating: true,
        destination: true, estimatedBudget: true, travelDate: true,
        numberOfTravelers: true, stageId: true, notes: true,
        assignedToId: true, convertedCustomerId: true,
        createdAt: true, updatedAt: true,
        assignedTo: { select: { id: true, name: true } },
        stage: { select: { id: true, title: true, color: true } },
        followUps: {
          where: { status: 'PENDING' },
          orderBy: { dueAt: 'asc' },
          take: 3,
          select: { id: true, dueAt: true, type: true },
        },
        labels: { include: { label: { select: { id: true, name: true, color: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Group leads by stageId in JS — no extra DB calls
  const leadsByStage = allLeads.reduce((acc, lead) => {
    const key = lead.stageId ?? '__unstaged__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(lead);
    return acc;
  }, {});

  const pipeline = stages.map((stage) => {
    const leads = leadsByStage[stage.id] ?? [];
    return { stage, leads, count: leads.length };
  });

  return pipeline;
};

// ═════════════════════════════════════════════════════════════════════════════
// EXCEL / CSV BULK IMPORT
// ═════════════════════════════════════════════════════════════════════════════

const VALID_SOURCES   = ['WEBSITE', 'MANUAL', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'MESSENGER', 'PHONE', 'OTHER'];
const VALID_PRIORITIES = ['HOT', 'WARM', 'COLD'];

const normaliseRow = (raw, defaults = {}) => {
  const pick = (...keys) => {
    for (const k of keys) {
      const val = raw[k];
      if (val !== undefined && val !== null && String(val).trim() !== '') return String(val).trim();
    }
    return null;
  };

  const name  = pick('name', 'Name', 'Full Name', 'fullName', 'FULL NAME', 'full_name');
  const phone = pick('phone', 'Phone', 'Phone Number', 'phone_number', 'PHONE', 'mobile', 'Mobile');

  if (!name) return null;

  let source = (pick('source', 'Source', 'SOURCE') || defaults.source || 'MANUAL').toUpperCase();
  if (!VALID_SOURCES.includes(source)) source = 'MANUAL';

  let priority = (pick('priority', 'Priority', 'PRIORITY') || defaults.priority || 'WARM').toUpperCase();
  if (!VALID_PRIORITIES.includes(priority)) priority = 'WARM';

  let estimatedBudget = null;
  const rawBudget = pick('estimatedBudget', 'budget', 'Budget', 'Estimated Budget', 'estimated_budget');
  if (rawBudget) {
    const cleaned = parseFloat(String(rawBudget).replace(/[₹,\s]/g, ''));
    if (!isNaN(cleaned) && cleaned > 0) estimatedBudget = cleaned;
  }

  let numberOfTravelers = null;
  const rawTravelers = pick('numberOfTravelers', 'travelers', 'Travelers', 'No of Travelers', 'pax', 'Pax');
  if (rawTravelers) {
    const cleaned = parseInt(String(rawTravelers).replace(/\D/g, ''), 10);
    if (!isNaN(cleaned) && cleaned > 0) numberOfTravelers = cleaned;
  }

  let travelDate = null;
  const rawDate = pick('travelDate', 'travel_date', 'Travel Date', 'departure', 'Departure Date');
  if (rawDate) {
    if (!isNaN(Number(rawDate))) {
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + Number(rawDate) * 86400000);
      if (!isNaN(d.getTime())) travelDate = d;
    } else {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) travelDate = d;
    }
  }

  return {
    name,
    ...(phone                && { phone }),
    ...(pick('email','Email','EMAIL') && { email: pick('email','Email','EMAIL') }),
    source,
    priority,
    ...(pick('destination','Destination','DESTINATION') && { destination: pick('destination','Destination','DESTINATION') }),
    ...(estimatedBudget     !== null && { estimatedBudget }),
    ...(travelDate          && { travelDate }),
    ...(numberOfTravelers   !== null && { numberOfTravelers }),
    ...(pick('notes','Notes','NOTES','remarks','Remarks') && { notes: pick('notes','Notes','NOTES','remarks','Remarks') }),
  };
};

export const importLeads = async (fileBuffer, fileExtension, options = {}, requestingUser) => {
  const { source, priority, stageId, removeDuplicates = true } = options;

  let rows = [];
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  } catch {
    throw new AppError('Could not parse the uploaded file. Make sure it is a valid CSV or XLSX.', 400);
  }

  if (!rows.length) throw new AppError('File is empty or has no data rows', 400);
  if (rows.length > 500) throw new AppError('Maximum 500 records allowed per import', 400);

  let resolvedStageId = stageId || null;
  if (!resolvedStageId) {
    const defaultStage = await prisma.leadStage.findFirst({ orderBy: { position: 'asc' } });
    if (defaultStage) resolvedStageId = defaultStage.id;
  }

  if (stageId) {
    const stageExists = await prisma.leadStage.findUnique({ where: { id: stageId } });
    if (!stageExists) throw new AppError('Provided stageId does not exist', 400);
  }

  let existingPhones = new Set();
  if (removeDuplicates) {
    const existing = await prisma.lead.findMany({ select: { phone: true } });
    existingPhones = new Set(existing.map((l) => l.phone?.replace(/\s/g, '')));
  }

  const defaults = {
    source: (source || 'MANUAL').toUpperCase(),
    priority: (priority || 'WARM').toUpperCase(),
  };

  let imported = 0;
  let skipped  = 0;
  const errors = [];

  // Batch inserts for performance — createMany where possible
  const toCreate = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    try {
      const normalised = normaliseRow(rows[i], defaults);

      if (!normalised) {
        skipped++;
        errors.push(`Row ${rowNum}: Missing name — skipped`);
        continue;
      }

      if (removeDuplicates && normalised.phone) {
        const cleanPhone = normalised.phone.replace(/\s/g, '');
        if (existingPhones.has(cleanPhone)) {
          skipped++;
          errors.push(`Row ${rowNum}: Duplicate phone (${normalised.phone}) — skipped`);
          continue;
        }
        existingPhones.add(cleanPhone);
      }

      if (!normalised.phone) {
        normalised.phone = `IMPORT-${Date.now()}-${rowNum}`;
      }

      toCreate.push({
        name:               normalised.name,
        phone:              normalised.phone,
        source:             normalised.source,
        priority:           normalised.priority,
        ...(normalised.email              && { email:              normalised.email }),
        ...(normalised.destination        && { destination:        normalised.destination }),
        ...(normalised.estimatedBudget    && { estimatedBudget:    normalised.estimatedBudget }),
        ...(normalised.travelDate         && { travelDate:         normalised.travelDate }),
        ...(normalised.numberOfTravelers  && { numberOfTravelers:  normalised.numberOfTravelers }),
        ...(normalised.notes              && { notes:              normalised.notes }),
        ...(resolvedStageId               && { stageId:            resolvedStageId }),
        ...(requestingUser.role === 'AGENT' && { assignedToId: requestingUser.id }),
      });
      imported++;
    } catch (err) {
      skipped++;
      errors.push(`Row ${rowNum}: ${err?.message ?? 'Unknown error'}`);
    }
  }

  // Bulk insert in batches of 50
  if (toCreate.length > 0) {
    const BATCH = 50;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      await prisma.lead.createMany({ data: toCreate.slice(i, i + BATCH), skipDuplicates: true });
    }
  }

  if (imported > 0) {
    emitToRole('ADMIN',   'leads_imported', { count: imported, by: requestingUser.name });
    emitToRole('MANAGER', 'leads_imported', { count: imported, by: requestingUser.name });
  }

  return { imported, skipped, errors };
};

// ═════════════════════════════════════════════════════════════════════════════
// GOOGLE FORM WEBHOOK
// ═════════════════════════════════════════════════════════════════════════════

export const handleGoogleFormWebhook = async (payload) => {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = payload[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };

  const name  = pick('name', 'Full Name', 'fullName', 'your_name', 'Name');
  const phone = pick('phone', 'Phone Number', 'phone_number', 'mobile', 'Phone');

  if (!name) throw new AppError('Name is required', 400);

  const defaultStage = await prisma.leadStage.findFirst({ orderBy: { position: 'asc' } });

  let estimatedBudget = null;
  const rawBudget = pick('budget', 'estimatedBudget', 'Budget', 'Estimated Budget');
  if (rawBudget) {
    const n = parseFloat(String(rawBudget).replace(/[₹,\s]/g, ''));
    if (!isNaN(n) && n > 0) estimatedBudget = n;
  }

  let travelDate = null;
  const rawDate = pick('travelDate', 'travel_date', 'Travel Date', 'departure');
  if (rawDate) {
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) travelDate = d;
  }

  let numberOfTravelers = null;
  const rawTravelers = pick('numberOfTravelers', 'travelers', 'Travelers', 'pax', 'No of Travelers');
  if (rawTravelers) {
    const n = parseInt(String(rawTravelers).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > 0) numberOfTravelers = n;
  }

  const lead = await prisma.lead.create({
    data: {
      name,
      phone: phone || `WEBHOOK-${Date.now()}`,
      source: 'WEBSITE',
      priority: 'WARM',
      ...(pick('email', 'Email') && { email: pick('email', 'Email') }),
      ...(pick('destination', 'Destination') && { destination: pick('destination', 'Destination') }),
      ...(estimatedBudget   !== null && { estimatedBudget }),
      ...(travelDate                 && { travelDate }),
      ...(numberOfTravelers !== null && { numberOfTravelers }),
      ...(pick('notes', 'message', 'Message', 'Notes') && { notes: pick('notes', 'message', 'Message', 'Notes') }),
      ...(defaultStage && { stageId: defaultStage.id }),
    },
  });

  // Notify admins of new webhook lead
  emitToRole('ADMIN', 'new_lead', { lead: sanitize(lead), source: 'google_form' });
  emitToRole('MANAGER', 'new_lead', { lead: sanitize(lead), source: 'google_form' });

  return lead;
};

// ═════════════════════════════════════════════════════════════════════════════
// NOTES
// ═════════════════════════════════════════════════════════════════════════════

export const addNote = async (leadId, content, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);
  if (requestingUser.role === 'AGENT' && existing.assignedToId !== requestingUser.id)
    throw new AppError('Access denied', 403);

  const note = await prisma.leadNote.create({ data: { leadId, content } });
  logActivity(leadId, requestingUser.id, 'note_added', 'Note added').catch(() => {});
  return note;
};

export const deleteNote = async (noteId) => {
  const note = await prisma.leadNote.findUnique({ where: { id: noteId } });
  if (!note) throw new AppError('Note not found', 404);
  await prisma.leadNote.delete({ where: { id: noteId } });
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS
// ═════════════════════════════════════════════════════════════════════════════

export const getFollowUps = async (leadId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);
  if (requestingUser.role === 'AGENT' && existing.assignedToId !== requestingUser.id)
    throw new AppError('Access denied', 403);

  return prisma.followUp.findMany({
    where: { leadId },
    include: { assignedTo: { select: { id: true, name: true } } },
    orderBy: { dueAt: 'asc' },
  });
};

export const createFollowUp = async (leadId, data, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  const followUp = await prisma.followUp.create({
    data: {
      leadId,
      type: data.type,
      dueAt: new Date(data.dueAt),
      ...(data.notes && { notes: data.notes }),
      assignedToId: data.assignedToId || requestingUser.id,
    },
    include: { assignedTo: { select: { id: true, name: true } } },
  });

  logActivity(leadId, requestingUser.id, 'followup_added', `Follow-up scheduled for ${new Date(data.dueAt).toLocaleDateString()}`).catch(() => {});
  return followUp;
};

export const updateFollowUp = async (leadId, followUpId, data, requestingUser) => {
  const followUp = await prisma.followUp.findFirst({ where: { id: followUpId, leadId } });
  if (!followUp) throw new AppError('Follow-up not found', 404);

  const updated = await prisma.followUp.update({
    where: { id: followUpId },
    data: {
      ...(data.type        && { type: data.type }),
      ...(data.status      && { status: data.status }),
      ...(data.dueAt       && { dueAt: new Date(data.dueAt) }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId }),
      ...(data.status === 'COMPLETED' && { completedAt: new Date() }),
    },
    include: { assignedTo: { select: { id: true, name: true } } },
  });

  return updated;
};

export const deleteFollowUp = async (leadId, followUpId, requestingUser) => {
  const followUp = await prisma.followUp.findFirst({ where: { id: followUpId, leadId } });
  if (!followUp) throw new AppError('Follow-up not found', 404);
  await prisma.followUp.delete({ where: { id: followUpId } });
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// TASKS
// ═════════════════════════════════════════════════════════════════════════════

export const getTasks = async (leadId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  return prisma.leadTask.findMany({
    where: { leadId },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy:  { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

export const createTask = async (leadId, data, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  const task = await prisma.leadTask.create({
    data: {
      leadId,
      title: data.title,
      ...(data.description  && { description: data.description }),
      priority: data.priority || 'MEDIUM',
      ...(data.dueAt        && { dueAt: new Date(data.dueAt) }),
      assignedToId: data.assignedToId || requestingUser.id,
      createdById: requestingUser.id,
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy:  { select: { id: true, name: true } },
    },
  });

  logActivity(leadId, requestingUser.id, 'task_created', `Task "${data.title}" created`).catch(() => {});
  return task;
};

export const updateTask = async (leadId, taskId, data, requestingUser) => {
  const task = await prisma.leadTask.findFirst({ where: { id: taskId, leadId } });
  if (!task) throw new AppError('Task not found', 404);

  return prisma.leadTask.update({
    where: { id: taskId },
    data: {
      ...(data.title        && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status       && { status: data.status }),
      ...(data.priority     && { priority: data.priority }),
      ...(data.dueAt        && { dueAt: new Date(data.dueAt) }),
      ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId }),
      ...(data.status === 'DONE' && { completedAt: new Date() }),
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy:  { select: { id: true, name: true } },
    },
  });
};

export const deleteTask = async (leadId, taskId, requestingUser) => {
  const task = await prisma.leadTask.findFirst({ where: { id: taskId, leadId } });
  if (!task) throw new AppError('Task not found', 404);
  await prisma.leadTask.delete({ where: { id: taskId } });
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// MEETINGS
// ═════════════════════════════════════════════════════════════════════════════

export const getMeetings = async (leadId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  return prisma.leadMeeting.findMany({
    where: { leadId },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy:  { select: { id: true, name: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
};

export const createMeeting = async (leadId, data, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  const meeting = await prisma.leadMeeting.create({
    data: {
      leadId,
      title: data.title,
      ...(data.description && { description: data.description }),
      scheduledAt: new Date(data.scheduledAt),
      ...(data.duration    && { duration: data.duration }),
      ...(data.location    && { location: data.location }),
      ...(data.meetingLink && data.meetingLink !== '' && { meetingLink: data.meetingLink }),
      ...(data.notes       && { notes: data.notes }),
      assignedToId: data.assignedToId || requestingUser.id,
      createdById: requestingUser.id,
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy:  { select: { id: true, name: true } },
    },
  });

  logActivity(leadId, requestingUser.id, 'meeting_created', `Meeting "${data.title}" scheduled`).catch(() => {});
  return meeting;
};

export const updateMeeting = async (leadId, meetingId, data, requestingUser) => {
  const meeting = await prisma.leadMeeting.findFirst({ where: { id: meetingId, leadId } });
  if (!meeting) throw new AppError('Meeting not found', 404);

  return prisma.leadMeeting.update({
    where: { id: meetingId },
    data: {
      ...(data.title        && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status       && { status: data.status }),
      ...(data.scheduledAt  && { scheduledAt: new Date(data.scheduledAt) }),
      ...(data.duration    !== undefined && { duration: data.duration }),
      ...(data.location    !== undefined && { location: data.location }),
      ...(data.meetingLink !== undefined && { meetingLink: data.meetingLink }),
      ...(data.notes       !== undefined && { notes: data.notes }),
      ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId }),
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
      createdBy:  { select: { id: true, name: true } },
    },
  });
};

export const deleteMeeting = async (leadId, meetingId, requestingUser) => {
  const meeting = await prisma.leadMeeting.findFirst({ where: { id: meetingId, leadId } });
  if (!meeting) throw new AppError('Meeting not found', 404);
  await prisma.leadMeeting.delete({ where: { id: meetingId } });
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// LABELS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllLabels = async () => {
  return prisma.leadLabel.findMany({ orderBy: { createdAt: 'asc' } });
};

export const createLabel = async (name, color) => {
  return prisma.leadLabel.create({ data: { name, color: color || '#6366f1' } });
};

export const deleteLabel = async (labelId) => {
  const label = await prisma.leadLabel.findUnique({ where: { id: labelId } });
  if (!label) throw new AppError('Label not found', 404);
  await prisma.leadLabel.delete({ where: { id: labelId } });
  return true;
};

export const addLabelToLead = async (leadId, labelId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  const label = await prisma.leadLabel.findUnique({ where: { id: labelId } });
  if (!label) throw new AppError('Label not found', 404);

  try {
    return await prisma.leadLabelAssignment.create({ data: { leadId, labelId } });
  } catch {
    throw new AppError('Label already assigned', 400);
  }
};

export const removeLabelFromLead = async (leadId, labelId, requestingUser) => {
  await prisma.leadLabelAssignment.deleteMany({ where: { leadId, labelId } });
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITY / HISTORY
// ═════════════════════════════════════════════════════════════════════════════

export const getActivities = async (leadId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  return prisma.leadActivity.findMany({
    where: { leadId },
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// QUOTATIONS
// ═════════════════════════════════════════════════════════════════════════════

export const getQuotations = async (leadId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, assignedToId: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  return prisma.leadQuotation.findMany({
    where: { leadId },
    include: { items: true, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

export const createQuotation = async (leadId, data, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  const quotationNumber = await generateNumber('leadQuotation', 'quotationNumber', 'QT');
  const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discount = data.discount || 0;
  const tax = data.tax || 0;
  const total = subtotal - discount + tax;

  const quotation = await prisma.leadQuotation.create({
    data: {
      leadId, quotationNumber, status: 'DRAFT',
      subtotal, discount, tax, total,
      ...(data.notes           && { notes: data.notes }),
      ...(data.termsConditions && { termsConditions: data.termsConditions }),
      ...(data.validUntil      && { validUntil: new Date(data.validUntil) }),
      createdById: requestingUser.id,
      items: {
        create: data.items.map((item) => ({
          description: item.description,
          quantity:    item.quantity,
          unitPrice:   item.unitPrice,
          total:       item.quantity * item.unitPrice,
        })),
      },
    },
    include: { items: true, createdBy: { select: { id: true, name: true } } },
  });

  logActivity(leadId, requestingUser.id, 'quotation_created', `Quotation ${quotationNumber} created`).catch(() => {});
  return quotation;
};

export const updateQuotation = async (leadId, quotationId, data, requestingUser) => {
  const quotation = await prisma.leadQuotation.findFirst({ where: { id: quotationId, leadId } });
  if (!quotation) throw new AppError('Quotation not found', 404);

  let updateData = {
    ...(data.status             && { status: data.status }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.termsConditions !== undefined && { termsConditions: data.termsConditions }),
    ...(data.validUntil         && { validUntil: new Date(data.validUntil) }),
  };

  if (data.items) {
    await prisma.leadQuotationItem.deleteMany({ where: { quotationId } });
    const subtotal = data.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const discount = data.discount ?? quotation.discount ?? 0;
    const tax = data.tax ?? quotation.tax ?? 0;
    updateData = { ...updateData, subtotal, discount, tax, total: subtotal - discount + tax };
  }

  return prisma.leadQuotation.update({
    where: { id: quotationId },
    data: {
      ...updateData,
      ...(data.items && {
        items: {
          create: data.items.map((item) => ({
            description: item.description,
            quantity:    item.quantity,
            unitPrice:   item.unitPrice,
            total:       item.quantity * item.unitPrice,
          })),
        },
      }),
    },
    include: { items: true, createdBy: { select: { id: true, name: true } } },
  });
};

export const deleteQuotation = async (leadId, quotationId, requestingUser) => {
  const quotation = await prisma.leadQuotation.findFirst({ where: { id: quotationId, leadId } });
  if (!quotation) throw new AppError('Quotation not found', 404);
  await prisma.leadQuotation.delete({ where: { id: quotationId } });
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
// LEAD INVOICES
// ═════════════════════════════════════════════════════════════════════════════

export const getLeadInvoices = async (leadId, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  return prisma.leadInvoice.findMany({
    where: { leadId },
    include: { items: true, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
};

export const createLeadInvoice = async (leadId, data, requestingUser) => {
  const existing = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!existing) throw new AppError('Lead not found', 404);

  const invoiceNumber = await generateNumber('leadInvoice', 'invoiceNumber', 'INV');
  const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discount = data.discount || 0;
  const tax = data.tax || 0;
  const total = subtotal - discount + tax;

  const invoice = await prisma.leadInvoice.create({
    data: {
      leadId, invoiceNumber, status: 'DRAFT',
      subtotal, discount, tax, total, paidAmount: 0,
      ...(data.notes   && { notes:   data.notes }),
      ...(data.dueDate && { dueDate: new Date(data.dueDate) }),
      createdById: requestingUser.id,
      items: {
        create: data.items.map((item) => ({
          description: item.description,
          quantity:    item.quantity,
          unitPrice:   item.unitPrice,
          total:       item.quantity * item.unitPrice,
        })),
      },
    },
    include: { items: true, createdBy: { select: { id: true, name: true } } },
  });

  logActivity(leadId, requestingUser.id, 'invoice_created', `Invoice ${invoiceNumber} created`).catch(() => {});
  return invoice;
};

export const updateLeadInvoice = async (leadId, invoiceId, data, requestingUser) => {
  const invoice = await prisma.leadInvoice.findFirst({ where: { id: invoiceId, leadId } });
  if (!invoice) throw new AppError('Invoice not found', 404);

  let updateData = {
    ...(data.status       && { status: data.status }),
    ...(data.notes !== undefined && { notes: data.notes }),
    ...(data.dueDate      && { dueDate: new Date(data.dueDate) }),
    ...(data.paidAmount !== undefined && { paidAmount: data.paidAmount }),
  };

  if (data.items) {
    await prisma.leadInvoiceItem.deleteMany({ where: { invoiceId } });
    const subtotal = data.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const discount = data.discount ?? invoice.discount ?? 0;
    const tax = data.tax ?? invoice.tax ?? 0;
    updateData = { ...updateData, subtotal, discount, tax, total: subtotal - discount + tax };
  }

  return prisma.leadInvoice.update({
    where: { id: invoiceId },
    data: {
      ...updateData,
      ...(data.items && {
        items: {
          create: data.items.map((item) => ({
            description: item.description,
            quantity:    item.quantity,
            unitPrice:   item.unitPrice,
            total:       item.quantity * item.unitPrice,
          })),
        },
      }),
    },
    include: { items: true, createdBy: { select: { id: true, name: true } } },
  });
};

export const deleteLeadInvoice = async (leadId, invoiceId, requestingUser) => {
  const invoice = await prisma.leadInvoice.findFirst({ where: { id: invoiceId, leadId } });
  if (!invoice) throw new AppError('Invoice not found', 404);
  await prisma.leadInvoice.delete({ where: { id: invoiceId } });
  return true;
};