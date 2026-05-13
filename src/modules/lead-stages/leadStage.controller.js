import * as stageService from './leadStage.service.js';
import { ApiResponse } from '../../utils/helpers.js';

export const getAllStages = async (req, res) => {
  const stages = await stageService.getAllStages();
  return ApiResponse.success(res, stages);
};

export const createStage = async (req, res) => {
  const { title, color, position, isWon } = req.body;
  if (!title) return ApiResponse.error(res, 'Title is required', 400);

  const stage = await stageService.createStage({
    title,
    color,
    position,
    isWon: isWon === true || isWon === 'true', // handle both bool & string
  });
  return ApiResponse.created(res, stage, 'Stage created successfully');
};

export const updateStage = async (req, res) => {
  const { title, color, position, isWon } = req.body;
  const stage = await stageService.updateStage(req.params.id, {
    title,
    color,
    position,
    isWon: isWon !== undefined ? (isWon === true || isWon === 'true') : undefined,
  });
  return ApiResponse.success(res, stage, 'Stage updated');
};

export const deleteStage = async (req, res) => {
  await stageService.deleteStage(req.params.id);
  return ApiResponse.success(res, null, 'Stage deleted');
};

export const reorderStages = async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return ApiResponse.error(res, 'orderedIds array required', 400);
  const stages = await stageService.reorderStages(orderedIds);
  return ApiResponse.success(res, stages, 'Stages reordered');
};