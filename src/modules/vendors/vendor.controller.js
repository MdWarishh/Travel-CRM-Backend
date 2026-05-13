/**
 * vendor.controller.js  — Upgraded Vendor Intelligence System
 */

import * as vendorService from './vendor.service.js';
import {
  createVendorSchema,
  updateVendorSchema,
  changeStatusSchema,
  addNoteSchema,
  updateNoteSchema,
  suggestVendorSchema,
} from './vendor.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─── List ─────────────────────────────────────────────────────────────────────

export const getAllVendors = async (req, res) => {
  const result = await vendorService.getAllVendors(req.query);
  return ApiResponse.paginated(res, result.vendors, result.pagination);
};

// ─── Detail ───────────────────────────────────────────────────────────────────

export const getVendorById = async (req, res) => {
  const vendor = await vendorService.getVendorById(req.params.id);
  return ApiResponse.success(res, vendor);
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const createVendor = async (req, res) => {
  const data   = createVendorSchema.parse(req.body);
  const vendor = await vendorService.createVendor(data);
  return ApiResponse.created(res, vendor, 'Vendor created');
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateVendor = async (req, res) => {
  const data   = updateVendorSchema.parse(req.body);
  const vendor = await vendorService.updateVendor(req.params.id, data);
  return ApiResponse.success(res, vendor, 'Vendor updated');
};

// ─── Change Status (active / inactive / blacklisted) ─────────────────────────

export const changeVendorStatus = async (req, res) => {
  const { status } = changeStatusSchema.parse(req.body);
  const vendor     = await vendorService.changeVendorStatus(req.params.id, status);
  return ApiResponse.success(res, vendor, `Vendor status changed to ${status}`);
};

// ─── Toggle Preferred ─────────────────────────────────────────────────────────

export const togglePreferred = async (req, res) => {
  const vendor = await vendorService.togglePreferred(req.params.id);
  return ApiResponse.success(
    res,
    vendor,
    vendor.isPreferred ? 'Marked as preferred' : 'Removed from preferred'
  );
};

// ─── Legacy toggle (active / inactive only) ───────────────────────────────────

export const toggleVendorStatus = async (req, res) => {
  const vendor = await vendorService.toggleVendorStatus(req.params.id);
  return ApiResponse.success(
    res,
    vendor,
    `Vendor ${vendor.isActive ? 'activated' : 'deactivated'}`
  );
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteVendor = async (req, res) => {
  await vendorService.deleteVendor(req.params.id);
  return ApiResponse.success(res, null, 'Vendor deleted');
};

// ─── Auto-suggest (for booking forms) ────────────────────────────────────────

export const suggestVendors = async (req, res) => {
  const query   = suggestVendorSchema.parse(req.query);
  const vendors = await vendorService.suggestVendors(query);
  return ApiResponse.success(res, vendors);
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export const getVendorDashboardStats = async (req, res) => {
  const stats = await vendorService.getVendorDashboardStats();
  return ApiResponse.success(res, stats);
};

// ─── Notes ────────────────────────────────────────────────────────────────────

export const addNote = async (req, res) => {
  const { content } = addNoteSchema.parse(req.body);
  const note        = await vendorService.addVendorNote(
    req.params.id,
    content,
    req.user?.id
  );
  return ApiResponse.created(res, note, 'Note added');
};

export const updateNote = async (req, res) => {
  const { content } = updateNoteSchema.parse(req.body);
  const note        = await vendorService.updateVendorNote(
    req.params.noteId,
    content,
    req.user?.id
  );
  return ApiResponse.success(res, note, 'Note updated');
};

export const deleteNote = async (req, res) => {
  await vendorService.deleteVendorNote(req.params.noteId);
  return ApiResponse.success(res, null, 'Note deleted');
};