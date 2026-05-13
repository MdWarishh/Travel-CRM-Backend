import * as reportService from './report.service.js';
import { ApiResponse } from '../../utils/helpers.js';

const getLeadReport = async (req, res) => {
  const data = await reportService.getLeadReport(req.query);
  return ApiResponse.success(res, data);
};

const getConversionReport = async (req, res) => {
  const data = await reportService.getConversionReport(req.query);
  return ApiResponse.success(res, data);
};

const getBookingReport = async (req, res) => {
  const data = await reportService.getBookingReport(req.query);
  return ApiResponse.success(res, data);
};

const getPaymentReport = async (req, res) => {
  const data = await reportService.getPaymentReport(req.query);
  return ApiResponse.success(res, data);
};

const getAgentPerformanceReport = async (req, res) => {
  const data = await reportService.getAgentPerformanceReport(req.query);
  return ApiResponse.success(res, data);
};

export {
  getLeadReport,
  getConversionReport,
  getBookingReport,
  getPaymentReport,
  getAgentPerformanceReport
};