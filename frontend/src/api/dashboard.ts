import client from './client';
import type { DashboardSummary } from '../types';

export const getDashboardSummary = async (month?: string) => {
  const params = month ? { month } : undefined;
  const response = await client.get<{ data: DashboardSummary }>('/dashboard/summary', { params });
  return response.data.data;
};
