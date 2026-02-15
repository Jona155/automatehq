import client from './client';
import type { Site, UploadAccessRequest, WhatsappBatchResponse } from '../types';

export interface GetSitesParams {
  active?: boolean;
  include_counts?: boolean;
}

const normalizeMonthFormat = (month: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(month)) {
    return month;
  }
  if (/^\d{4}-\d{2}$/.test(month)) {
    return `${month}-01`;
  }
  return month;
};

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

export const downloadMonthlySummary = async (
  siteId: string,
  processingMonth: string,
  options?: { approved_only?: boolean; include_inactive?: boolean }
) => {
  const response = await client.get(`/sites/${siteId}/summary/export`, {
    params: {
      processing_month: normalizeMonthFormat(processingMonth),
      approved_only: options?.approved_only ? 'true' : 'false',
      include_inactive: options?.include_inactive ? 'true' : 'false',
    },
    responseType: 'blob',
  });
  return response.data as Blob;
};

export const downloadMonthlySummaryBatch = async (
  processingMonth: string,
  options?: { approved_only?: boolean; include_inactive?: boolean; include_inactive_sites?: boolean }
) => {
  const response = await client.get('/sites/summary/export-batch', {
    params: {
      processing_month: normalizeMonthFormat(processingMonth),
      approved_only: options?.approved_only ? 'true' : 'false',
      include_inactive: options?.include_inactive ? 'true' : 'false',
      include_inactive_sites: options?.include_inactive_sites ? 'true' : 'false',
    },
    responseType: 'blob',
  });
  return response.data as Blob;
};

export const downloadSalaryTemplate = async (
  siteId: string,
  processingMonth: string,
  options?: { include_inactive?: boolean }
) => {
  const response = await client.get(`/sites/${siteId}/salary-template/export`, {
    params: {
      processing_month: normalizeMonthFormat(processingMonth),
      include_inactive: options?.include_inactive === false ? 'false' : 'true',
    },
    responseType: 'blob',
  });
  return response.data as Blob;
};

export const downloadSalaryTemplateBatch = async (
  processingMonth: string,
  options?: { include_inactive?: boolean; include_inactive_sites?: boolean }
) => {
  const response = await client.get('/sites/salary-template/export-batch', {
    params: {
      processing_month: normalizeMonthFormat(processingMonth),
      include_inactive: options?.include_inactive === false ? 'false' : 'true',
      include_inactive_sites: options?.include_inactive_sites ? 'true' : 'false',
    },
    responseType: 'blob',
  });
  return response.data as Blob;
};
