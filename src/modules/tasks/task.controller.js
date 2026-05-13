import * as taskService from './task.service.js';
import { ApiResponse } from '../../utils/helpers.js';
import {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from './task.validation.js';

// ─── List all tasks (with filters) ───────────────────────────────────────────
export const getAllTasks = async (req, res) => {
  const result = await taskService.getAllTasks(req.query, req.user);
  return ApiResponse.paginated(res, result.tasks, result.pagination);
};

// ─── Get single task ──────────────────────────────────────────────────────────
export const getTaskById = async (req, res) => {
  const task = await taskService.getTaskById(req.params.id, req.user);
  return ApiResponse.success(res, task);
};

// ─── Create task ──────────────────────────────────────────────────────────────
export const createTask = async (req, res) => {
  const data = createTaskSchema.parse(req.body);
  const task = await taskService.createTask(data, req.user);

  // Real-time: notify admin/manager of new task
  const io = req.app.get('io');
  io.to('role:ADMIN').emit('task_created', { task });
  io.to('role:MANAGER').emit('task_created', { task });

  return ApiResponse.created(res, task, 'Task created successfully');
};

// ─── Update task ──────────────────────────────────────────────────────────────
export const updateTask = async (req, res) => {
  const data = updateTaskSchema.parse(req.body);
  const task = await taskService.updateTask(req.params.id, data, req.user);

  // Real-time: notify assignee
  const io = req.app.get('io');
  if (task.assignedToId) {
    io.to(`user:${task.assignedToId}`).emit('task_updated', { task });
  }

  return ApiResponse.success(res, task, 'Task updated successfully');
};

// ─── Update task status only ──────────────────────────────────────────────────
export const updateTaskStatus = async (req, res) => {
  const { status } = updateTaskStatusSchema.parse(req.body);
  const task = await taskService.updateTask(req.params.id, { status }, req.user);
  return ApiResponse.success(res, task, `Task marked as ${status.toLowerCase()}`);
};

// ─── Delete task ──────────────────────────────────────────────────────────────
export const deleteTask = async (req, res) => {
  await taskService.deleteTask(req.params.id, req.user);
  return ApiResponse.success(res, null, 'Task deleted successfully');
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────
export const getTaskStats = async (req, res) => {
  const stats = await taskService.getTaskStats(req.user);
  return ApiResponse.success(res, stats);
};