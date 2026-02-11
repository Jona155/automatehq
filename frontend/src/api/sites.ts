import client from './client';
import type { Site, UploadAccessRequest, WhatsappBatchResponse } from '../types';

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

export const updateSite = async (
  id: string,
  data: { site_name?: string; site_code?: string; is_active?: boolean; responsible_employee_id?: string | null }
) => {
  const response = await client.put<{ data: Site }>(`/sites/${id}`, data);
  return response.data.data;
};

export const deleteSite = async (id: string) => {
  const response = await client.delete(`/sites/${id}`);
  return response.data;
};

export const createAccessLink = async (siteId: string, data: { employee_id: string; processing_month: string }) => {
  const response = await client.post<{ data: UploadAccessRequest }>(`/sites/${siteId}/access-link`, data);
  return response.data.data;
};

export const getAccessLinks = async (siteId: string) => {
  const response = await client.get<{ data: UploadAccessRequest[] }>(`/sites/${siteId}/access-links`);
  return response.data.data;
};

export const revokeAccessLink = async (siteId: string, requestId: string) => {
  const response = await client.post(`/sites/${siteId}/access-link/${requestId}/revoke`);
  return response.data;
};

export const sendAccessLinkToWhatsapp = async (siteId: string, requestId: string) => {
  const response = await client.post<{ message: string }>(`/sites/${siteId}/access-link/${requestId}/whatsapp`);
  return response.data;
};

export const sendAccessLinksBatchToWhatsapp = async (data: { site_ids: string[]; processing_month: string }) => {
  const response = await client.post<{ data: WhatsappBatchResponse }>('/sites/access-links/whatsapp-batch', data);
  return response.data.data;
};
