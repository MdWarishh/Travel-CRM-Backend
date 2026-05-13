import * as ticketService from './ticket.service.js';
import {
  createSellerSchema,
  updateSellerSchema,
  createBuyerSchema,
  updateBuyerSchema,
  createDealSchema,
  updateDealSchema,
  createPaymentSchema,
  agentPermissionSchema,
  bulkImportSchema,
} from './ticket.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION MIDDLEWARE HELPER
// ─────────────────────────────────────────────────────────────────────────────

const withPermission = (permission) => async (req, res, next) => {
  try {
    await ticketService.checkTicketPermission(req.user.id, req.user.role, permission);
    next();
  } catch (err) {
    return ApiResponse.error(res, err.message, err.statusCode || 403);
  }
};

export const permissionMiddleware = {
  viewSellers:   withPermission('canViewSellers'),
  addSellers:    withPermission('canAddSellers'),
  editSellers:   withPermission('canEditSellers'),
  deleteSellers: withPermission('canDeleteSellers'),
  viewBuyers:    withPermission('canViewBuyers'),
  addBuyers:     withPermission('canAddBuyers'),
  editBuyers:    withPermission('canEditBuyers'),
  deleteBuyers:  withPermission('canDeleteBuyers'),
  viewDeals:     withPermission('canViewDeals'),
  addDeals:      withPermission('canAddDeals'),
  editDeals:     withPermission('canEditDeals'),
  deleteDeals:   withPermission('canDeleteDeals'),
  viewReports:   withPermission('canViewReports'),
  importData:    withPermission('canImportData'),
};

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═════════════════════════════════════════════════════════════════════════════

export const getDashboardStats = async (req, res) => {
  const stats = await ticketService.getDashboardStats();
  return ApiResponse.success(res, stats);
};

// ═════════════════════════════════════════════════════════════════════════════
// MATCHING ENGINE
// ═════════════════════════════════════════════════════════════════════════════

export const getMatches = async (req, res) => {
  const matches = await ticketService.findMatches();
  return ApiResponse.success(res, matches);
};

// ═════════════════════════════════════════════════════════════════════════════
// AGENT PERMISSIONS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllAgentPermissions = async (req, res) => {
  const perms = await ticketService.getAllAgentPermissions();
  return ApiResponse.success(res, perms);
};

export const getAgentPermissions = async (req, res) => {
  const perms = await ticketService.getAgentPermissions(req.params.userId);
  return ApiResponse.success(res, perms);
};

export const upsertAgentPermissions = async (req, res) => {
  const data = agentPermissionSchema.parse(req.body);
  const perms = await ticketService.upsertAgentPermissions(data);
  return ApiResponse.success(res, perms, 'Permissions updated successfully');
};

// ═════════════════════════════════════════════════════════════════════════════
// TICKET SELLERS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllSellers = async (req, res) => {
  const sellers = await ticketService.getAllSellers(req.query);
  return ApiResponse.success(res, sellers);
};

export const getSellerById = async (req, res) => {
  const seller = await ticketService.getSellerById(req.params.id);
  return ApiResponse.success(res, seller);
};

export const createSeller = async (req, res) => {
  if (req.user.role === 'BUYER') {
    return ApiResponse.error(res, 'Buyers cannot create seller listings', 403);
  }
  const data = createSellerSchema.parse(req.body);
  const result = await ticketService.createSeller(data, req.user);
  return ApiResponse.created(res, result, 'Seller listing added successfully');
};

export const updateSeller = async (req, res) => {
  if (req.user.role === 'BUYER') {
    return ApiResponse.error(res, 'Buyers cannot modify seller listings', 403);
  }
  const data = updateSellerSchema.parse(req.body);
  const seller = await ticketService.updateSeller(req.params.id, data, req.user);
  return ApiResponse.success(res, seller, 'Seller listing updated successfully');
};

export const deleteSeller = async (req, res) => {
  await ticketService.deleteSeller(req.params.id);
  return ApiResponse.success(res, null, 'Seller listing deleted successfully');
};

// ═════════════════════════════════════════════════════════════════════════════
// TICKET BUYERS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllBuyers = async (req, res) => {
  const buyers = await ticketService.getAllBuyers(req.query);
  return ApiResponse.success(res, buyers);
};

export const getBuyerById = async (req, res) => {
  const buyer = await ticketService.getBuyerById(req.params.id);
  return ApiResponse.success(res, buyer);
};

export const createBuyer = async (req, res) => {
  if (req.user.role === 'SELLER') {
    return ApiResponse.error(res, 'Sellers cannot create buyer requests', 403);
  }
  const data = createBuyerSchema.parse(req.body);
  const result = await ticketService.createBuyer(data, req.user);
  return ApiResponse.created(res, result, 'Buyer request added successfully');
};

export const updateBuyer = async (req, res) => {
  if (req.user.role === 'SELLER') {
    return ApiResponse.error(res, 'Sellers cannot modify buyer requests', 403);
  }
  const data = updateBuyerSchema.parse(req.body);
  const buyer = await ticketService.updateBuyer(req.params.id, data, req.user);
  return ApiResponse.success(res, buyer, 'Buyer request updated successfully');
};

export const deleteBuyer = async (req, res) => {
  await ticketService.deleteBuyer(req.params.id);
  return ApiResponse.success(res, null, 'Buyer request deleted successfully');
};

// ═════════════════════════════════════════════════════════════════════════════
// TICKET DEALS
// ═════════════════════════════════════════════════════════════════════════════

export const getAllDeals = async (req, res) => {
  const deals = await ticketService.getAllDeals(req.query);
  return ApiResponse.success(res, deals);
};

export const getDealById = async (req, res) => {
  const deal = await ticketService.getDealById(req.params.id);
  return ApiResponse.success(res, deal);
};

export const connectDeal = async (req, res) => {
  const data = createDealSchema.parse(req.body);
  const deal = await ticketService.connectDeal(data, req.user);
  return ApiResponse.created(res, deal, 'Deal connected successfully');
};

export const updateDeal = async (req, res) => {
  const data = updateDealSchema.parse(req.body);
  const deal = await ticketService.updateDeal(req.params.id, data, req.user);
  return ApiResponse.success(res, deal, 'Deal updated successfully');
};

export const deleteDeal = async (req, res) => {
  await ticketService.deleteDeal(req.params.id);
  return ApiResponse.success(res, null, 'Deal deleted successfully');
};

// ═════════════════════════════════════════════════════════════════════════════
// PAYMENT LEDGER (NEW)
// ═════════════════════════════════════════════════════════════════════════════

export const getDealPayments = async (req, res) => {
  const payments = await ticketService.getDealPayments(req.params.id);
  return ApiResponse.success(res, payments);
};

export const addPayment = async (req, res) => {
  const data = createPaymentSchema.parse(req.body);
  const payment = await ticketService.addPayment(req.params.id, data, req.user);
  return ApiResponse.created(res, payment, 'Payment recorded successfully');
};

export const deletePayment = async (req, res) => {
  await ticketService.deletePayment(req.params.paymentId);
  return ApiResponse.success(res, null, 'Payment record deleted');
};

// ═════════════════════════════════════════════════════════════════════════════
// REPORTS (NEW)
// ═════════════════════════════════════════════════════════════════════════════

export const getRevenueReport = async (req, res) => {
  const report = await ticketService.getRevenueReport(req.query);
  return ApiResponse.success(res, report);
};

// ═════════════════════════════════════════════════════════════════════════════
// BULK IMPORT (NEW)
// ═════════════════════════════════════════════════════════════════════════════

export const bulkImport = async (req, res) => {
  const data = bulkImportSchema.parse(req.body);
  const result = await ticketService.bulkImport(data, req.user);
  return ApiResponse.created(res, result, `Import complete: ${result.success} success, ${result.failed} failed`);
};

export const getImportHistory = async (req, res) => {
  const history = await ticketService.getImportHistory();
  return ApiResponse.success(res, history);
};

// ═════════════════════════════════════════════════════════════════════════════
// WHATSAPP LINK GENERATOR
// ═════════════════════════════════════════════════════════════════════════════

export const getWhatsAppLink = async (req, res) => {
  const { targetRole = 'seller' } = req.query;
  if (!['seller', 'buyer'].includes(targetRole)) {
    return ApiResponse.error(res, 'targetRole must be "seller" or "buyer"', 400);
  }
  const result = await ticketService.generateWhatsAppLink(req.params.id, targetRole);
  return ApiResponse.success(res, result, 'WhatsApp link generated');
};