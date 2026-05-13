import * as itineraryService from './itinerary.service.js';
import { generateItineraryPdf } from '../pdf/pdf.service.js';
import {
  createItinerarySchema,
  updateItinerarySchema,
  addDaySchema,
  generatePdfSchema,
  updateStatusSchema,
} from './itinerary.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

export const getAllItineraries = async (req, res) => {
  const result = await itineraryService.getAllItineraries(req.query, req.user);
  return ApiResponse.paginated(res, result.itineraries, result.pagination);
};

export const getItineraryById = async (req, res) => {
  const itinerary = await itineraryService.getItineraryById(req.params.id);
  return ApiResponse.success(res, itinerary);
};

export const createItinerary = async (req, res) => {
  const data = createItinerarySchema.parse(req.body);
  const itinerary = await itineraryService.createItinerary(data, req.user);
  return ApiResponse.created(res, itinerary, 'Itinerary created');
};

export const updateItinerary = async (req, res) => {
  const data = updateItinerarySchema.parse(req.body);
  const itinerary = await itineraryService.updateItinerary(req.params.id, data);
  return ApiResponse.success(res, itinerary, 'Itinerary updated');
};

export const deleteItinerary = async (req, res) => {
  await itineraryService.deleteItinerary(req.params.id);
  return ApiResponse.success(res, null, 'Itinerary deleted');
};

// ─────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────

export const updateStatus = async (req, res) => {
  const { status } = updateStatusSchema.parse(req.body);
  const itinerary = await itineraryService.updateStatus(req.params.id, status);
  return ApiResponse.success(res, itinerary, 'Status updated');
};

// ─────────────────────────────────────────────
// DUPLICATE
// ─────────────────────────────────────────────

export const duplicateItinerary = async (req, res) => {
  const { customerId } = req.body;
  const itinerary = await itineraryService.duplicateItinerary(
    req.params.id,
    customerId,
    req.user
  );
  return ApiResponse.created(res, itinerary, 'Itinerary duplicated');
};

// ─────────────────────────────────────────────
// DAY MANAGEMENT
// ─────────────────────────────────────────────

export const upsertDay = async (req, res) => {
  const data = addDaySchema.parse(req.body);
  const day = await itineraryService.upsertDay(req.params.id, data);
  return ApiResponse.success(res, day, 'Day saved');
};

export const deleteDay = async (req, res) => {
  await itineraryService.deleteDay(req.params.id, req.params.dayId);
  return ApiResponse.success(res, null, 'Day deleted');
};

// ─────────────────────────────────────────────
// PDF GENERATION
// Input: itineraryId + optional leadId / overrides
// Customer name is injected dynamically from lead
// ─────────────────────────────────────────────

export const generatePdf = async (req, res) => {
  const options = generatePdfSchema.parse(req.body);
  const itinerary = await itineraryService.getItineraryById(req.params.id);

  // Resolve customer name
  let customerName = options.customerName || null;
  let travelDate = options.travelDate || itinerary.startDate;
  let numberOfTravelers = options.numberOfTravelers || itinerary.numberOfTravelers;

  if (options.leadId) {
    const lead = await import('../../config/db.js').then((m) =>
      m.default.lead.findUnique({
        where: { id: options.leadId },
        select: { name: true, travelDate: true, numberOfTravelers: true },
      })
    );
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    customerName = customerName || lead.name;
    travelDate = travelDate || lead.travelDate;
    numberOfTravelers = numberOfTravelers || lead.numberOfTravelers;
  }

  const pdfBuffer = await generateItineraryPdf(itinerary, {
    customerName,
    travelDate,
    numberOfTravelers,
  });

  // Debug: log buffer info — remove after confirming PDF works
  console.log('[PDF] Buffer type:', pdfBuffer.constructor.name, '| Size:', pdfBuffer.length, 'bytes | Header:', pdfBuffer.slice(0,4).toString('ascii'));

  const safeName = itinerary.title
    .replace(/[^a-zA-Z0-9\s-]/g, '')   // strip special chars
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);

  const filename = `itinerary-${safeName}-${Date.now()}.pdf`;

  // Do NOT set Content-Length manually — Express calculates it correctly
  // from the Buffer. Manual value can be wrong if buffer is Uint8Array.
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });

  // end() instead of send() — skip Express body middleware, raw buffer only
  return res.end(pdfBuffer);
};