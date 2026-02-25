import axios from 'axios';

const API_BASE_URL = import.meta.env.DEV ? 'http://localhost:5000/api' : '/api';
const REQUEST_TIMEOUT_MS = 15000;

const publicClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

export interface PortalVerificationResponse {
  session_token: string;
  site_name: string;
  employee_name: string;
  month: string;
}

export const verifyPortalAccess = async (payload: { token: string; phone_number: string }) => {
  const response = await publicClient.post<{ data: PortalVerificationResponse }>('/public/verify-access', payload);
  return response.data.data;
};

export const uploadPortalFiles = async (sessionToken: string, files: File[]) => {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const response = await publicClient.post('/public/upload', formData, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data.data;
};

export interface AdminPortalSite {
  id: string;
  site_name: string;
}

export interface AdminPortalVerificationResponse {
  session_token: string;
  user_name: string;
  business_name: string;
  sites: AdminPortalSite[];
}

export const verifyAdminPortalAccess = async (payload: {
  business_code: string;
  phone_number: string;
}): Promise<AdminPortalVerificationResponse> => {
  const response = await publicClient.post<{ data: AdminPortalVerificationResponse }>('/public/admin-verify', payload);
  return response.data.data;
};

export const uploadAdminPortalFiles = async (
  sessionToken: string,
  meta: { site_id?: string; processing_month: string },
  files: File[],
): Promise<{ uploaded: any[]; failed: any[]; total: number }> => {
  const formData = new FormData();
  if (meta.site_id) formData.append('site_id', meta.site_id);
  formData.append('processing_month', meta.processing_month);
  files.forEach((file) => formData.append('files', file));
  const response = await publicClient.post('/public/admin-upload', formData, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data.data;
};
