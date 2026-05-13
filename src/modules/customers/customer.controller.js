import customerService from './customer.service.js';
import {
  createCustomerSchema,
  updateCustomerSchema,
  sendWhatsAppSchema,
  sendEmailSchema,
  createTemplateSchema,
  updateTemplateSchema,
  addNoteSchema,
  updateNoteSchema,
} from './customer.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// CUSTOMERS — CRUD
// ─────────────────────────────────────────────

export const getAllCustomers = async (req, res) => {
  const result = await customerService.getAllCustomers(req.query, req.user);
  return ApiResponse.paginated(res, result.customers, result.pagination);
};

export const getCustomerById = async (req, res) => {
  const customer = await customerService.getCustomerById(req.params.id, req.user);
  return ApiResponse.success(res, customer);
};

export const createCustomer = async (req, res) => {
  const data = createCustomerSchema.parse(req.body);
  const customer = await customerService.createCustomer(data, req.user);
  return ApiResponse.created(res, customer, 'Customer created successfully');
};

export const createCustomerFromLead = async (req, res) => {
  const { leadId } = req.params;
  const customer = await customerService.createCustomerFromLead(leadId, req.user);
  return ApiResponse.created(res, customer, 'Customer created from lead');
};

export const updateCustomer = async (req, res) => {
  const data = updateCustomerSchema.parse(req.body);
  const customer = await customerService.updateCustomer(req.params.id, data, req.user);
  return ApiResponse.success(res, customer, 'Customer updated successfully');
};

export const deleteCustomer = async (req, res) => {
  await customerService.deleteCustomer(req.params.id);
  return ApiResponse.success(res, null, 'Customer deleted');
};

// ─────────────────────────────────────────────
// TIMELINE
// ─────────────────────────────────────────────

export const getCustomerTimeline = async (req, res) => {
  const timeline = await customerService.getCustomerTimeline(req.params.id, req.user);
  return ApiResponse.success(res, timeline);
};

// ─────────────────────────────────────────────
// COMMUNICATION — WhatsApp & Email
// ─────────────────────────────────────────────

export const sendWhatsApp = async (req, res) => {
  const data = sendWhatsAppSchema.parse(req.body);
  const result = await customerService.sendWhatsApp(data, req.user);
  return ApiResponse.success(res, result, 'WhatsApp prepared successfully');
};

export const sendEmail = async (req, res) => {
  const data = sendEmailSchema.parse(req.body);
  const result = await customerService.sendEmail(data, req.user);
  return ApiResponse.success(res, result, 'Email sent successfully');
};

export const getCommunications = async (req, res) => {
  const communications = await customerService.getCustomerCommunications(
    req.params.id,
    req.user
  );
  return ApiResponse.success(res, communications);
};

// ─────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────

export const getNotes = async (req, res) => {
  const notes = await customerService.getCustomerNotes(req.params.id, req.user);
  return ApiResponse.success(res, notes);
};

export const addNote = async (req, res) => {
  const data = addNoteSchema.parse(req.body);
  const note = await customerService.addNote(req.params.id, data, req.user);
  return ApiResponse.created(res, note, 'Note added');
};

export const updateNote = async (req, res) => {
  const data = updateNoteSchema.parse(req.body);
  const note = await customerService.updateNote(
    req.params.id,
    req.params.noteId,
    data,
    req.user
  );
  return ApiResponse.success(res, note, 'Note updated');
};

export const deleteNote = async (req, res) => {
  await customerService.deleteNote(req.params.id, req.params.noteId, req.user);
  return ApiResponse.success(res, null, 'Note deleted');
};

// ─────────────────────────────────────────────
// ACTIVITY LOG
// ─────────────────────────────────────────────

export const getActivityLog = async (req, res) => {
  const logs = await customerService.getActivityLog(req.params.id, req.user);
  return ApiResponse.success(res, logs);
};

// ─────────────────────────────────────────────
// COMMUNICATION TEMPLATES
// ─────────────────────────────────────────────

export const getTemplates = async (req, res) => {
  const { type } = req.query; // WHATSAPP | EMAIL
  const templates = await customerService.getTemplates(type);
  return ApiResponse.success(res, templates);
};

export const createTemplate = async (req, res) => {
  const data = createTemplateSchema.parse(req.body);
  const template = await customerService.createTemplate(data, req.user);
  return ApiResponse.created(res, template, 'Template created');
};

export const updateTemplate = async (req, res) => {
  const data = updateTemplateSchema.parse(req.body);
  const template = await customerService.updateTemplate(req.params.templateId, data);
  return ApiResponse.success(res, template, 'Template updated');
};

export const deleteTemplate = async (req, res) => {
  await customerService.deleteTemplate(req.params.templateId);
  return ApiResponse.success(res, null, 'Template deleted');
};

// ─────────────────────────────────────────────
// PDF SHARE LOG
// ─────────────────────────────────────────────

export const sharePdf = async (req, res) => {
  const { documentUrl, channel, entityType } = req.body;
  const result = await customerService.sharePdf(
    { customerId: req.params.id, documentUrl, channel, entityType },
    req.user
  );
  return ApiResponse.success(res, result, 'PDF share logged');
};