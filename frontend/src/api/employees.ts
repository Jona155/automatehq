import client from './client';
import type { Employee } from '../types';

export interface CreateEmployeePayload {
  site_id: string;
  full_name: string;
  passport_id: string;
  phone_number: string;
  external_employee_id?: string;
}

export interface UpdateEmployeePayload {
  site_id?: string;
  full_name?: string;
  passport_id?: string;
  phone_number?: string;
  external_employee_id?: string;
}

export interface GetEmployeesParams {
  active?: boolean;
  site_id?: string;
  name?: string;
}

export const getEmployees = async (params?: GetEmployeesParams) => {
  const response = await client.get<{ data: Employee[] }>('/employees', { params });
  return response.data.data;
};

export const getEmployee = async (id: string) => {
  const response = await client.get<{ data: Employee }>(`/employees/${id}`);
  return response.data.data;
};

export const createEmployee = async (data: CreateEmployeePayload) => {
  const response = await client.post<{ data: Employee }>('/employees', data);
  return response.data.data;
};

export const updateEmployee = async (id: string, data: UpdateEmployeePayload) => {
  const response = await client.put<{ data: Employee }>(`/employees/${id}`, data);
  return response.data.data;
};

export const deleteEmployee = async (id: string) => {
  const response = await client.delete(`/employees/${id}`);
  return response.data;
};
