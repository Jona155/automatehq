import client from './client';
import type { DashboardSummary } from '../types';

export const getDashboardSummary = async (month?: string, bustCache?: boolean) => {
  const params: Record<string, string> = {};
  if (month) params.month = month;
  if (bustCache) params.bust_cache = '1';
  const response = await client.get<{ data: DashboardSummary }>('/dashboard/summary', { params });
  return response.data.data;
};
