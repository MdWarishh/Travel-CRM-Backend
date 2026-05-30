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
// IMAGE URL HELPER
// Puppeteer runs in a separate process and cannot
// access localhost URLs. Only absolute https:// URLs
// (e.g. Cloudinary) work inside the PDF renderer.
// This helper converts any image URL to base64 so
// Puppeteer can embed it without any network call.
// ─────────────────────────────────────────────

const toBase64DataUrl = async (url) => {
  if (!url) return null;

  // Only process absolute http/https URLs
  if (!url.startsWith('http')) return url;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (err) {
    console.warn(`[PDF] Could not fetch image: ${url}`, err.message);
    return null; // skip broken image rather than crash
  }
};

/**
 * Deep-converts all image URLs in an itinerary object to base64 data URIs
 * so Puppeteer can render them without making outbound HTTP requests.
 */
const resolveItineraryImages = async (itinerary) => {
  // Clone to avoid mutating the original object
  const clone = JSON.parse(JSON.stringify(itinerary));

  // Hero image
  if (clone.heroImageUrl) {
    clone.heroImageUrl = await toBase64DataUrl(clone.heroImageUrl);
  }

  // Thank you background
  if (clone.thankYou?.backgroundImageUrl) {
    clone.thankYou.backgroundImageUrl = await toBase64DataUrl(
      clone.thankYou.backgroundImageUrl
    );
  }

  // Day images
  if (Array.isArray(clone.days)) {
    for (const day of clone.days) {
      if (Array.isArray(day.images)) {
        for (const img of day.images) {
          img.url = await toBase64DataUrl(img.url);
        }
      }
    }
  }

  // Account QR codes
  if (Array.isArray(clone.accounts)) {
    for (const acc of clone.accounts) {
      if (acc.upiQrImageUrl) {
        acc.upiQrImageUrl = await toBase64DataUrl(acc.upiQrImageUrl);
      }
    }
  }

  return clone;
};

// ─────────────────────────────────────────────
// PDF GENERATION
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

  // ✅ Convert all image URLs → base64 so Puppeteer renders them correctly
  const itineraryWithImages = await resolveItineraryImages(itinerary);

  const pdfBuffer = await generateItineraryPdf(itineraryWithImages, {
    customerName,
    travelDate,
    numberOfTravelers,
  });

  console.log(
    '[PDF] Buffer type:', pdfBuffer.constructor.name,
    '| Size:', pdfBuffer.length, 'bytes',
    '| Header:', pdfBuffer.slice(0, 4).toString('ascii')
  );

  const safeName = itinerary.title
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);

  const filename = `itinerary-${safeName}-${Date.now()}.pdf`;

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });

  return res.end(pdfBuffer);
};