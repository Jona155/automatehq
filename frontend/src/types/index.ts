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

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    token: string;
    user: User;
  };
}
