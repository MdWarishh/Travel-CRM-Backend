import followupService from './followup.service.js';
import { createFollowUpSchema, updateFollowUpSchema } from './followup.validation.js';
import { ApiResponse } from '../../utils/helpers.js';

export const getAllFollowUps = async (req, res) => {
  const result = await followupService.getAllFollowUps(req.query, req.user);
  return ApiResponse.paginated(res, result.followUps, result.pagination);
};

export const getTodayFollowUps = async (req, res) => {
  const followUps = await followupService.getTodayFollowUps(req.user);
  return ApiResponse.success(res, followUps);
};

export const createFollowUp = async (req, res) => {
  const data = createFollowUpSchema.parse(req.body);
  const followUp = await followupService.createFollowUp(data, req.user);
  return ApiResponse.created(res, followUp, 'Follow-up scheduled');
};

export const updateFollowUp = async (req, res) => {
  const data = updateFollowUpSchema.parse(req.body);
  const followUp = await followupService.updateFollowUp(req.params.id, data, req.user);
  return ApiResponse.success(res, followUp, 'Follow-up updated');
};

export const deleteFollowUp = async (req, res) => {
  await followupService.deleteFollowUp(req.params.id);
  return ApiResponse.success(res, null, 'Follow-up deleted');
};