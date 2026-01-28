import client from './client';
import type { Site } from '../types';

export interface GetSitesParams {
  active?: boolean;
  include_counts?: boolean;
}

export const getSites = async (params?: GetSitesParams) => {
  const requestParams = { ...params, include_counts: true };
  const response = await client.get<{ data: Site[] }>('/sites', { params: requestParams });
  return response.data.data;
};

export const getSite = async (id: string) => {
  const response = await client.get<{ data: Site }>(`/sites/${id}`);
  return response.data.data;
};

export const createSite = async (data: { site_name: string; site_code?: string }) => {
  const response = await client.post<{ data: Site }>('/sites', data);
  return response.data.data;
};

export const updateSite = async (id: string, data: { site_name?: string; site_code?: string; is_active?: boolean }) => {
  const response = await client.put<{ data: Site }>(`/sites/${id}`, data);
  return response.data.data;
};

export const deleteSite = async (id: string) => {
  const response = await client.delete(`/sites/${id}`);
  return response.data;
};
