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
}

export interface Employee {
  id: string;
  business_id: string;
  site_id: string;
  full_name: string;
  passport_id: string;
  phone_number: string;
  external_employee_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  site?: Site;
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
  created_at: string;
  updated_at: string;
}
