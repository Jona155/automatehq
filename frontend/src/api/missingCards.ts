import client from './client';

const normalizeMonth = (month: string): string =>
  /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;

export type MissingStatus = 'NONE' | 'PARTIAL' | 'COMPLETE';

export interface MissingEmployeeRow {
  employee_id: string;
  full_name: string;
  passport_id: string | null;
  phone_number: string | null;
  site_id: string | null;
  site_name: string | null;
  field_manager_id: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  cards_count: number;
  expected: number;
  status: MissingStatus;
  first_uploaded_at: string | null;
}

export interface MissingSummary {
  total_employees: number;
  none: number;
  partial: number;
  complete: number;
  missing: number;
  sites_with_gaps: number;
  managers_with_gaps: number;
}

export interface ManagerGroup {
  field_manager_id: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  total_employees: number;
  complete_count: number;
  none_count: number;
  partial_count: number;
  missing_count: number;
  employees: MissingEmployeeRow[];
}

export interface SiteGroup {
  site_id: string | null;
  site_name: string | null;
  field_manager_id: string | null;
  manager_name: string | null;
  manager_phone: string | null;
  total_employees: number;
  complete_count: number;
  none_count: number;
  partial_count: number;
  missing_count: number;
  employees: MissingEmployeeRow[];
}

export interface MissingCardsResponse<G> {
  month: string;
  group_by: 'field_manager' | 'site';
  summary: MissingSummary;
  groups: G[];
}

export interface BroadcastResultEntry {
  manager_id: string | null;
  manager_name: string | null;
  employee_count?: number;
  reason?: string;
  error?: string;
}

export interface BroadcastResult {
  sent: BroadcastResultEntry[];
  skipped: BroadcastResultEntry[];
  failed: BroadcastResultEntry[];
}

export const getMissingCardsByManager = async (
  month: string,
): Promise<MissingCardsResponse<ManagerGroup>> => {
  const response = await client.get<{ data: MissingCardsResponse<ManagerGroup> }>('/missing-cards', {
    params: { month: normalizeMonth(month), group_by: 'field_manager' },
  });
  return response.data.data;
};

export const getMissingCardsBySite = async (
  month: string,
): Promise<MissingCardsResponse<SiteGroup>> => {
  const response = await client.get<{ data: MissingCardsResponse<SiteGroup> }>('/missing-cards', {
    params: { month: normalizeMonth(month), group_by: 'site' },
  });
  return response.data.data;
};

export const sendManagerWhatsapp = async (
  userId: string,
  month: string,
): Promise<{ employee_count: number }> => {
  const response = await client.post<{ data: { employee_count: number } }>(
    `/missing-cards/managers/${userId}/whatsapp`,
    { processing_month: normalizeMonth(month) },
  );
  return response.data.data;
};

export const broadcastWhatsapp = async (month: string): Promise<BroadcastResult> => {
  const response = await client.post<{ data: BroadcastResult }>('/missing-cards/whatsapp/broadcast', {
    processing_month: normalizeMonth(month),
  });
  return response.data.data;
};

export const downloadManagerReport = async (userId: string, month: string): Promise<Blob> => {
  const response = await client.get(`/missing-cards/managers/${userId}/export`, {
    params: { month: normalizeMonth(month) },
    responseType: 'blob',
  });
  return response.data;
};
