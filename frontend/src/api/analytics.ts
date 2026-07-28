import client from './client';
import type { SiteScorecard, SiteAnalyticsDetail, EmployeeAnalyticsDetail } from '../types';

// Read-only performance analytics. Tenant + auth are injected by the axios
// interceptor (JWT + X-Business-Id), so no businessId is passed here. `period`
// defaults server-side to 'prev_month'.

export const getSiteScorecard = async (period?: string) => {
  const params: Record<string, string> = {};
  if (period) params.period = period;
  const response = await client.get<{ data: SiteScorecard }>('/analytics/site-scorecard', { params });
  return response.data.data;
};

export const getSiteAnalytics = async (siteId: string, period?: string) => {
  const params: Record<string, string> = {};
  if (period) params.period = period;
  const response = await client.get<{ data: SiteAnalyticsDetail }>(`/analytics/sites/${siteId}`, { params });
  return response.data.data;
};

export const getEmployeeAnalytics = async (siteId: string, employeeId: string, period?: string) => {
  const params: Record<string, string> = {};
  if (period) params.period = period;
  const response = await client.get<{ data: EmployeeAnalyticsDetail }>(
    `/analytics/sites/${siteId}/employees/${employeeId}`,
    { params },
  );
  return response.data.data;
};
