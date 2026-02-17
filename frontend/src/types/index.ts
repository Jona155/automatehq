export interface Business {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export interface User {
  id: string;
  business_id: string;
  full_name: string;
  email: string;
  phone_number?: string;
  role: 'ADMIN' | 'EMPLOYEE' | 'RESPONSIBLE_EMPLOYEE';
  is_active: boolean;
  created_at: string;
  updated_at: string;
  business?: Business;
}

export interface Site {
  id: string;
  business_id: string;
  site_name: string;
  site_code?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  employee_count?: number;
  responsible_employee_id?: string | null;
}

export type EmployeeStatus = 'ACTIVE' | 'REPORTED_IN_SPARK' | 'REPORTED_RETURNED_FROM_ESCAPE';

export interface Employee {
  id: string;
  business_id: string;
  site_id: string;
  full_name: string;
  passport_id: string;
  phone_number: string;
  status?: EmployeeStatus | null;
  external_employee_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  site?: Site;
}

export interface EmployeeImportRow {
  row_number: number | null;
  passport_id: string | null;
  full_name: string | null;
  phone_number: string | null;
  site_name: string | null;
  site_id: string | null;
  status_raw: string | null;
  status: EmployeeStatus | null;
  action: 'create' | 'update' | 'no_change' | 'error';
  changes: Array<{ field: string; from: string | null; to: string | null }>;
  errors: Array<string | { code: string; details?: any }>;
  warnings: Array<string | { code: string; details?: any }>;
  current?: {
    full_name: string | null;
    phone_number: string | null;
    site_id: string | null;
    site_name: string | null;
    status: EmployeeStatus | null;
  } | null;
}

export interface EmployeeImportSummary {
  create: number;
  update: number;
  no_change: number;
  error: number;
  total: number;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    token: string;
    user: User;
  };
}

export interface WorkCard {
  id: string;
  business_id: string;
  site_id: string;
  employee_id: string | null;
  processing_month: string;
  review_status: 'NEEDS_ASSIGNMENT' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED';
  approved_by_user_id: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  employee?: Employee;
  site?: Site;
}

export interface DayEntry {
  id: string;
  work_card_id: string;
  day_of_month: number;
  from_time: string | null;
  to_time: string | null;
  total_hours: number | null;
  source?: string | null;
  is_valid?: boolean;
  has_conflict?: boolean;
  conflict_type?: 'WITH_APPROVED' | 'WITH_PENDING' | null;
  is_locked?: boolean;
  locked_from_previous?: boolean;
  previous_work_card_id?: string | null;
  previous_work_card_status?: 'NEEDS_ASSIGNMENT' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | null;
  previous_entry?: {
    day_of_month: number;
    from_time: string | null;
    to_time: string | null;
    total_hours: number | null;
  } | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeUploadStatus {
  employee: Employee;
  status: 'NO_UPLOAD' | 'PENDING' | 'EXTRACTED' | 'APPROVED' | 'FAILED';
  work_card_id: string | null;
}

export interface MatrixData {
  employees: Employee[];
  matrix: Record<string, Record<number, number>>; // employee_id -> day -> hours
  status_map: Record<string, string | null>; // employee_id -> review_status
}

export interface WorkCardExtraction {
  id: string;
  work_card_id: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  attempts: number;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  extracted_employee_name: string | null;
  extracted_passport_id: string | null;
  matched_employee_id: string | null;
  match_method: string | null;
  match_confidence: number | null;
  model_name: string | null;
  pipeline_version: string | null;
  raw_result_jsonb?: {
    strategy?: string;
    selected_passport_id_normalized?: string | null;
    passport_id_candidates?: Array<{
      raw: string;
      normalized: string | null;
      source_region?: string | null;
      confidence?: number | null;
    }>;
    normalized_passport_candidates?: string[];
    row_quality?: WorkCardExtractionQuality | null;
    template_profile?: WorkCardTemplateProfile | null;
    targeted_reread?: {
      enabled?: boolean;
      requested_days?: number[];
      applied_days?: number[];
      error?: string;
    };
  } | null;
  normalized_result_jsonb?: {
    entries?: Array<Record<string, unknown>>;
    identity_mismatch?: boolean;
    identity_reason?: string | null;
    match_is_exact?: boolean | null;
    match_is_fuzzy?: boolean | null;
    matched_normalized_passport_id?: string | null;
    review_required_days?: number[];
    off_mark_days?: number[];
    row_quality_by_day?: Record<string, WorkCardDayQuality>;
    match_candidates?: Array<Record<string, unknown>>;
    matching_decision_reason?: string | null;
    match_distance?: number | null;
    match_candidate_count?: number | null;
    template_profile?: WorkCardTemplateProfile | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface WorkCardDayQuality {
  row_state?: 'WORKED' | 'OFF_MARK' | 'EMPTY' | 'ILLEGIBLE' | null;
  mark_type?: 'NONE' | 'SINGLE_LINE' | 'CROSS' | 'HATCH' | null;
  row_confidence?: number | null;
  has_valid_time_pair?: boolean;
  review_required?: boolean;
  reasons?: string[];
  evidence?: string[];
}

export interface WorkCardExtractionQuality {
  review_required_days?: number[];
  off_mark_days?: number[];
  row_quality_by_day?: Record<string, WorkCardDayQuality>;
}

export interface WorkCardTemplateProfile {
  orientation?: 'landscape' | 'portrait' | 'unknown';
  image_width?: number;
  image_height?: number;
  table_sections_detected?: number;
  table_layout_confidence?: number | null;
  row_density_estimate?: number | null;
}

export interface UploadAccessRequest {
  id: string;
  token: string;
  business_id: string;
  site_id: string;
  employee_id: string;
  processing_month: string;
  created_by_user_id: string | null;
  created_at: string;
  expires_at: string | null;
  last_accessed_at: string | null;
  is_active: boolean;
  url?: string;
  employee_name?: string;
}

export type WhatsappBatchStatus = 'sent' | 'skipped' | 'failed';

export interface WhatsappBatchResultItem {
  site_id: string;
  site_name?: string;
  employee_id?: string;
  employee_name?: string;
  request_id?: string;
  status: WhatsappBatchStatus;
  reason?: string;
}

export interface WhatsappBatchResponse {
  total_requested: number;
  processing_month: string;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  results: WhatsappBatchResultItem[];
}

export interface DashboardSummary {
  month: string;
  generated_at: string;
  metrics: {
    sites: number;
    employees: number;
    work_cards: number;
  };
  sites_table: Array<{
    site_id: string;
    site_name: string;
    employee_count: number;
  }>;
  work_card_status: Array<{
    status: string;
    count: number;
  }>;
  trends: {
    months: string[];
    employees: number[];
    sites: number[];
    work_cards: number[];
  };
}
