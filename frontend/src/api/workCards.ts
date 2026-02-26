import client from './client';
import type { WorkCard, DayEntry, EmployeeUploadStatus, MatrixData, WorkCardExtraction, Employee } from '../types';

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

export interface WorkCardExportParams {
  site_id: string;
  processing_month: string;
  statuses: string[];
  employee_ids?: string[];
  include_unassigned?: boolean;
  include_metadata?: boolean;
  include_day_entries?: boolean;
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
export interface ApproveWorkCardOptions {
  override_conflict_days?: number[];
  confirm_override_approved?: boolean;
}

export const approveWorkCard = async (cardId: string, userId: string, options?: ApproveWorkCardOptions) => {
  const response = await client.post<{ data: WorkCard }>(`/work_cards/${cardId}/approve`, {
    user_id: userId,
    ...(options || {}),
  });
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

// Export work cards as a ZIP
export const downloadWorkCardsExport = async (params: WorkCardExportParams): Promise<Blob> => {
  const queryParams: Record<string, string> = {
    site_id: params.site_id,
    month: normalizeMonthFormat(params.processing_month),
    status: params.statuses.join(','),
    include_unassigned: params.include_unassigned ? 'true' : 'false',
    include_metadata: params.include_metadata ? 'true' : 'false',
    include_day_entries: params.include_day_entries ? 'true' : 'false',
  };
  if (params.employee_ids && params.employee_ids.length > 0) {
    queryParams.employee_ids = params.employee_ids.join(',');
  }

  const response = await client.get('/work_cards/export', {
    params: queryParams,
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

// Re-trigger hours-only extraction (preserves employee assignment, replaces day entries)
export const reextractHours = async (cardId: string) => {
  const response = await client.post<{ data: WorkCardExtraction }>(`/work_cards/${cardId}/reextract-hours`);
  return response.data.data;
};

// Get extraction status for a work card
export const getExtraction = async (cardId: string) => {
  const response = await client.get<{ data: WorkCardExtraction }>(`/work_cards/${cardId}/extraction`);
  return response.data.data;
};

export async function getMissingWorkCardEmployees(params: {
  month: string;
  site_id?: string;
}): Promise<Employee[]> {
  const response = await client.get<{ data: Employee[] }>('/work_cards/missing', { params });
  return response.data.data;
}

// Upload batch work cards without a site (employee-first flow)
export const uploadSitelessBatchWorkCards = async (processingMonth: string, files: File[]) => {
  const formData = new FormData();
  formData.append('processing_month', normalizeMonthFormat(processingMonth));

  files.forEach((file) => {
    formData.append('files', file);
  });

  const response = await client.post<{ data: UploadBatchResponse }>('/work_cards/upload/siteless-batch', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data.data;
};

export interface UnassignedWorkCard {
  id: string;
  business_id: string;
  site_id: string | null;
  employee_id: string | null;
  processing_month: string;
  source: string;
  original_filename: string | null;
  review_status: string;
  created_at: string;
  extraction?: {
    id: string;
    status: string;
    extracted_employee_name: string | null;
    extracted_passport_id: string | null;
    match_method: string | null;
    match_confidence: number | null;
    normalized_result_jsonb: Record<string, unknown> | null;
  } | null;
}

export interface UnassignedCardsPage {
  items: UnassignedWorkCard[];
  total: number;
  page: number;
  page_size: number;
}

// Get unassigned work cards (business-wide, no employee)
export const getUnassignedWorkCards = async (params: { month?: string; page?: number; page_size?: number }) => {
  const queryParams: Record<string, string> = {};
  if (params.month) queryParams.month = normalizeMonthFormat(params.month);
  if (params.page) queryParams.page = String(params.page);
  if (params.page_size) queryParams.page_size = String(params.page_size);

  const response = await client.get<{ data: UnassignedCardsPage }>('/work_cards/unassigned', { params: queryParams });
  return response.data.data;
};
