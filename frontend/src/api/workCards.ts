import client from './client';
import type { WorkCard, DayEntry, EmployeeUploadStatus, MatrixData, WorkCardExtraction } from '../types';

// Helper to normalize month format: converts YYYY-MM to YYYY-MM-01 if needed
const normalizeMonthFormat = (month: string): string => {
  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(month)) {
    return month;
  }
  // If in YYYY-MM format, append -01
  if (/^\d{4}-\d{2}$/.test(month)) {
    return `${month}-01`;
  }
  // Return as is if format is unexpected (will likely fail on backend, but let it handle the error)
  return month;
};

export interface GetWorkCardsParams {
  site_id: string;
  processing_month: string;
  review_status?: string;
  include_employee?: boolean;
}

export interface UpdateDayEntriesRequest {
  entries: Array<{
    day_of_month: number;
    from_time: string | null;
    to_time: string | null;
    total_hours: number | null;
  }>;
}

export interface UploadBatchResponse {
  uploaded: Array<{
    work_card_id: string;
    file_name: string;
  }>;
  failed: Array<{
    file_name: string;
    error: string;
  }>;
}

export interface GetMatrixParams {
  approved_only?: boolean;
  include_inactive?: boolean;
}

// List work cards with optional filtering
export const getWorkCards = async (params: GetWorkCardsParams) => {
  const normalizedParams: Record<string, string> = {
    site_id: params.site_id,
    month: normalizeMonthFormat(params.processing_month),
  };
  if (params.review_status) {
    normalizedParams.status = params.review_status;
  }
  if (params.include_employee) {
    normalizedParams.include_employee = 'true';
  }
  const response = await client.get<{ data: WorkCard[] }>('/work_cards', { params: normalizedParams });
  return response.data.data;
};

// Get single work card with optional details
export const getWorkCard = async (cardId: string, details?: boolean) => {
  const params = details ? { details: true } : {};
  const response = await client.get<{ data: WorkCard }>(`/work_cards/${cardId}`, { params });
  return response.data.data;
};

// Update work card (assign employee, notes, etc.)
export const updateWorkCard = async (cardId: string, data: { employee_id?: string; notes?: string }) => {
  const response = await client.put<{ data: WorkCard }>(`/work_cards/${cardId}`, data);
  return response.data.data;
};

// Approve work card
export const approveWorkCard = async (cardId: string, userId: string) => {
  const response = await client.post<{ data: WorkCard }>(`/work_cards/${cardId}/approve`, { user_id: userId });
  return response.data.data;
};

// Delete work card
export const deleteWorkCard = async (cardId: string) => {
  const response = await client.delete<{ message: string }>(`/work_cards/${cardId}`);
  return response.data;
};

// Upload single work card for a specific employee
export const uploadSingleWorkCard = async (
  siteId: string,
  employeeId: string,
  processingMonth: string,
  file: File
) => {
  const formData = new FormData();
  formData.append('site_id', siteId);
  formData.append('employee_id', employeeId);
  formData.append('processing_month', normalizeMonthFormat(processingMonth));
  formData.append('file', file);

  const response = await client.post<{ data: WorkCard }>('/work_cards/upload/single', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data.data;
};

// Bulk upload work cards for unknown employees
export const uploadBatchWorkCards = async (siteId: string, processingMonth: string, files: File[]) => {
  const formData = new FormData();
  formData.append('site_id', siteId);
  formData.append('processing_month', normalizeMonthFormat(processingMonth));
  
  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await client.post<{ data: UploadBatchResponse }>('/work_cards/upload/batch', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data.data;
};

// Get work card image file as blob
export const getWorkCardFile = async (cardId: string): Promise<Blob> => {
  const response = await client.get(`/work_cards/${cardId}/file`, {
    responseType: 'blob',
  });
  return response.data;
};

// Get day entries for a work card
export const getDayEntries = async (cardId: string) => {
  const response = await client.get<{ data: DayEntry[] }>(`/work_cards/${cardId}/day-entries`);
  return response.data.data;
};

// Bulk update day entries for a work card
export const updateDayEntries = async (cardId: string, entries: UpdateDayEntriesRequest) => {
  const response = await client.put<{ data: DayEntry[] }>(`/work_cards/${cardId}/day-entries`, entries);
  return response.data.data;
};

// Get employee upload status for a site and month
export const getEmployeeUploadStatus = async (siteId: string, processingMonth: string) => {
  const response = await client.get<{ data: EmployeeUploadStatus[] }>(
    `/sites/${siteId}/employee-upload-status`,
    {
      params: { processing_month: normalizeMonthFormat(processingMonth) },
    }
  );
  return response.data.data;
};

// Get hours matrix for a site and month
export const getHoursMatrix = async (
  siteId: string,
  processingMonth: string,
  params?: GetMatrixParams
) => {
  const response = await client.get<{ data: MatrixData }>(`/sites/${siteId}/matrix`, {
    params: {
      processing_month: normalizeMonthFormat(processingMonth),
      ...params,
    },
  });
  return response.data.data;
};

// Trigger extraction for a work card
export const triggerExtraction = async (cardId: string) => {
  const response = await client.post<{ data: WorkCardExtraction }>(`/work_cards/${cardId}/extract`);
  return response.data.data;
};

// Get extraction status for a work card
export const getExtraction = async (cardId: string) => {
  const response = await client.get<{ data: WorkCardExtraction }>(`/work_cards/${cardId}/extraction`);
  return response.data.data;
};
