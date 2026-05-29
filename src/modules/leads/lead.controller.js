import * as leadService from './lead.service.js';
import multer from 'multer';
import {
  createLeadSchema,
  updateLeadSchema,
  addLeadNoteSchema,
  assignLeadSchema,
  createFollowUpSchema,
  updateFollowUpSchema,
  createTaskSchema,
  updateTaskSchema,
  createMeetingSchema,
  updateMeetingSchema,
  createLabelSchema,
  createQuotationSchema,
  updateQuotationSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
} from './lead.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─── Multer — memory storage (CSV / XLSX) ─────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV or XLSX files are allowed'), false);
    }
  },
}).single('file');

export const uploadMiddleware = (req, res, next) => {
  upload(req, res, (err) => {
    if (err) return ApiResponse.error(res, err.message, 400);
    next();
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// LEADS — CRUD
// ═════════════════════════════════════════════════════════════════════════════

export const getAllLeads = async (req, res) => {
  const result = await leadService.getAllLeads(req.query, req.user);
  return ApiResponse.paginated(res, result.leads, result.pagination);
};

export const getLeadById = async (req, res) => {
  const lead = await leadService.getLeadById(req.params.id, req.user);
  return ApiResponse.success(res, lead);
};

export const createLead = async (req, res) => {
  const data = createLeadSchema.parse(req.body);
  const lead = await leadService.createLead(data, req.user);

  // Emit via app-level io (set in server.js)
  const io = req.app.get('io');
  if (io) {
    const safe = JSON.parse(JSON.stringify(lead));
    io.to('role:ADMIN').emit('new_lead', { lead: safe });
    io.to('role:MANAGER').emit('new_lead', { lead: safe });
    if (lead.assignedToId) io.to(`user:${lead.assignedToId}`).emit('lead_assigned', { lead: safe });
  }

  return ApiResponse.created(res, lead, 'Lead created successfully');
};

export const updateLead = async (req, res) => {
  const data = updateLeadSchema.parse(req.body);
  const lead = await leadService.updateLead(req.params.id, data, req.user);
  return ApiResponse.success(res, lead, 'Lead updated successfully');
};

export const deleteLead = async (req, res) => {
  await leadService.deleteLead(req.params.id, req.user);
  return ApiResponse.success(res, null, 'Lead deleted successfully');
};

export const assignLead = async (req, res) => {
  const { assignedToId } = assignLeadSchema.parse(req.body);
  const lead = await leadService.assignLead(req.params.id, assignedToId, req.user);
  return ApiResponse.success(res, lead, 'Lead assigned successfully');
};

export const convertToCustomer = async (req, res) => {
  const result = await leadService.convertToCustomer(req.params.id, req.user);
  return ApiResponse.success(res, result, 'Lead converted to customer successfully');
};

export const getLeadPipeline = async (req, res) => {
  const pipeline = await leadService.getLeadPipeline(req.user);
  return ApiResponse.success(res, pipeline);
};

export const changeLeadStage = async (req, res) => {
  const { stageId } = req.body;
  if (!stageId) return ApiResponse.error(res, 'stageId is required', 400);
  
  const result = await leadService.changeLeadStage(req.params.id, stageId, req.user);
  
  const message = result.autoConverted
    ? result.alreadyExisted
      ? 'Stage updated — linked to existing customer'
      : 'Stage updated — customer created automatically!'
    : 'Lead stage updated';

  return ApiResponse.success(res, result, message);
};

// ─── Rating ───────────────────────────────────────────────────────────────────
export const updateLeadRating = async (req, res) => {
  const { rating } = req.body;
  if (rating === undefined || rating === null) return ApiResponse.error(res, 'rating is required', 400);
  const result = await leadService.updateLeadRating(req.params.id, rating, req.user);
  return ApiResponse.success(res, result, 'Rating updated');
};

// ═════════════════════════════════════════════════════════════════════════════
// EXCEL / CSV IMPORT
// ═════════════════════════════════════════════════════════════════════════════

export const importLeads = async (req, res) => {
  if (!req.file) return ApiResponse.error(res, 'No file uploaded', 400);

  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const options = {
    source:           req.body.source           || 'MANUAL',
    priority:         req.body.priority         || 'WARM',
    stageId:          req.body.stageId          || null,
    removeDuplicates: req.body.removeDuplicates !== 'false',
  };

  const result = await leadService.importLeads(req.file.buffer, ext, options, req.user);
  return ApiResponse.success(res, result, `${result.imported} leads imported successfully`);
};

// ═════════════════════════════════════════════════════════════════════════════
// GOOGLE FORM WEBHOOK
// ═════════════════════════════════════════════════════════════════════════════

export const googleFormWebhook = async (req, res) => {
  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const lead = await leadService.handleGoogleFormWebhook(req.body);

  // Notify via socket if available
  const io = req.app.get('io');
  if (io) {
    const safe = JSON.parse(JSON.stringify(lead));
    io.to('role:ADMIN').emit('new_lead', { lead: safe, source: 'google_form' });
    io.to('role:MANAGER').emit('new_lead', { lead: safe, source: 'google_form' });
  }

  return res.status(201).json({ success: true, message: 'Lead created', id: lead.id });
};

// ═════════════════════════════════════════════════════════════════════════════
// NOTES
// ═════════════════════════════════════════════════════════════════════════════

export const addNote = async (req, res) => {
  const { content } = addLeadNoteSchema.parse(req.body);
  const note = await leadService.addNote(req.params.id, content, req.user);
  return ApiResponse.created(res, note, 'Note added');
};

export const deleteNote = async (req, res) => {
  await leadService.deleteNote(req.params.noteId);
  return ApiResponse.success(res, null, 'Note deleted');
};

// ═════════════════════════════════════════════════════════════════════════════
// FOLLOW-UPS
// ═════════════════════════════════════════════════════════════════════════════

export const getFollowUps = async (req, res) => {
  const followUps = await leadService.getFollowUps(req.params.id, req.user);
  return ApiResponse.success(res, followUps);
};

export const createFollowUp = async (req, res) => {
  const data = createFollowUpSchema.parse(req.body);
  const followUp = await leadService.createFollowUp(req.params.id, data, req.user);
  return ApiResponse.created(res, followUp, 'Follow-up created');
};

export const updateFollowUp = async (req, res) => {
  const data = updateFollowUpSchema.parse(req.body);
  const followUp = await leadService.updateFollowUp(req.params.id, req.params.followUpId, data, req.user);
  return ApiResponse.success(res, followUp, 'Follow-up updated');
};

export const deleteFollowUp = async (req, res) => {
  await leadService.deleteFollowUp(req.params.id, req.params.followUpId, req.user);
  return ApiResponse.success(res, null, 'Follow-up deleted');
};

// ═════════════════════════════════════════════════════════════════════════════
// TASKS
// ═════════════════════════════════════════════════════════════════════════════

export const getTasks = async (req, res) => {
  const tasks = await leadService.getTasks(req.params.id, req.user);
  return ApiResponse.success(res, tasks);
};

export const createTask = async (req, res) => {
  const data = createTaskSchema.parse(req.body);
  const task = await leadService.createTask(req.params.id, data, req.user);
  return ApiResponse.created(res, task, 'Task created');
};

export const updateTask = async (req, res) => {
  const data = updateTaskSchema.parse(req.body);
  const task = await leadService.updateTask(req.params.id, req.params.taskId, data, req.user);
  return ApiResponse.success(res, task, 'Task updated');
};

export const deleteTask = async (req, res) => {
  await leadService.deleteTask(req.params.id, req.params.taskId, req.user);
  return ApiResponse.success(res, null, 'Task deleted');
};

// ═════════════════════════════════════════════════════════════════════════════
// MEETINGS
// ═════════════════════════════════════════════════════════════════════════════

export const getMeetings = async (req, res) => {
  const meetings = await leadService.getMeetings(req.params.id, req.user);
  return ApiResponse.success(res, meetings);
};

export const createMeeting = async (req, res) => {
  const data = createMeetingSchema.parse(req.body);
  const meeting = await leadService.createMeeting(req.params.id, data, req.user);
  return ApiResponse.created(res, meeting, 'Meeting created');
};

export const updateMeeting = async (req, res) => {
  const data = updateMeetingSchema.parse(req.body);
  const meeting = await leadService.updateMeeting(req.params.id, req.params.meetingId, data, req.user);
  return ApiResponse.success(res, meeting, 'Meeting updated');
};

export const deleteMeeting = async (req, res) => {
  await leadService.deleteMeeting(req.params.id, req.params.meetingId, req.user);
  return ApiResponse.success(res, null, 'Meeting deleted');
};

// ═════════════════════════════════════════════════════════════════════════════
// LABELS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllLabels = async (req, res) => {
  const labels = await leadService.getAllLabels();
  return ApiResponse.success(res, labels);
};

export const createLabel = async (req, res) => {
  const { name, color } = createLabelSchema.parse(req.body);
  const label = await leadService.createLabel(name, color);
  return ApiResponse.created(res, label, 'Label created');
};

export const deleteLabel = async (req, res) => {
  await leadService.deleteLabel(req.params.labelId);
  return ApiResponse.success(res, null, 'Label deleted');
};

export const addLabelToLead = async (req, res) => {
  const { labelId } = req.body;
  if (!labelId) return ApiResponse.error(res, 'labelId is required', 400);
  const result = await leadService.addLabelToLead(req.params.id, labelId, req.user);
  return ApiResponse.created(res, result, 'Label assigned');
};

export const removeLabelFromLead = async (req, res) => {
  await leadService.removeLabelFromLead(req.params.id, req.params.labelId, req.user);
  return ApiResponse.success(res, null, 'Label removed');
};

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITY / HISTORY
// ═════════════════════════════════════════════════════════════════════════════

export const getActivities = async (req, res) => {
  const activities = await leadService.getActivities(req.params.id, req.user);
  return ApiResponse.success(res, activities);
};

// ═════════════════════════════════════════════════════════════════════════════
// QUOTATIONS
// ═════════════════════════════════════════════════════════════════════════════

export const getQuotations = async (req, res) => {
  const quotations = await leadService.getQuotations(req.params.id, req.user);
  return ApiResponse.success(res, quotations);
};

export const createQuotation = async (req, res) => {
  const data = createQuotationSchema.parse(req.body);
  const quotation = await leadService.createQuotation(req.params.id, data, req.user);
  return ApiResponse.created(res, quotation, 'Quotation created');
};

export const updateQuotation = async (req, res) => {
  const data = updateQuotationSchema.parse(req.body);
  const quotation = await leadService.updateQuotation(req.params.id, req.params.quotationId, data, req.user);
  return ApiResponse.success(res, quotation, 'Quotation updated');
};

export const deleteQuotation = async (req, res) => {
  await leadService.deleteQuotation(req.params.id, req.params.quotationId, req.user);
  return ApiResponse.success(res, null, 'Quotation deleted');
};

// ═════════════════════════════════════════════════════════════════════════════
// LEAD INVOICES
// ═════════════════════════════════════════════════════════════════════════════

export const getLeadInvoices = async (req, res) => {
  const invoices = await leadService.getLeadInvoices(req.params.id, req.user);
  return ApiResponse.success(res, invoices);
};

export const createLeadInvoice = async (req, res) => {
  const data = createInvoiceSchema.parse(req.body);
  const invoice = await leadService.createLeadInvoice(req.params.id, data, req.user);
  return ApiResponse.created(res, invoice, 'Invoice created');
};

export const updateLeadInvoice = async (req, res) => {
  const data = updateInvoiceSchema.parse(req.body);
  const invoice = await leadService.updateLeadInvoice(req.params.id, req.params.invoiceId, data, req.user);
  return ApiResponse.success(res, invoice, 'Invoice updated');
};

export const deleteLeadInvoice = async (req, res) => {
  await leadService.deleteLeadInvoice(req.params.id, req.params.invoiceId, req.user);
  return ApiResponse.success(res, null, 'Invoice deleted');
};