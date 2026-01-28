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
