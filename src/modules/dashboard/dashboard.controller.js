import * as dashboardService from './dashboard.service.js';
import { ApiResponse } from '../../utils/helpers.js';

const getDashboard = async (req, res) => {
  const { role, id } = req.user;
  let data;

  if (role === 'ADMIN') {
    data = await dashboardService.getAdminDashboard();
  } else if (role === 'MANAGER') {
    data = await dashboardService.getManagerDashboard(id);
  } else {
    data = await dashboardService.getAgentDashboard(id);
  }

  return ApiResponse.success(res, data);
};

export { getDashboard };