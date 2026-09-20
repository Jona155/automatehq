import client from './client';
import type { Contractor } from '../types';

export interface ContractorPayload {
  name?: string;
  email?: string | null;
  phone_number?: string | null;
  address?: string | null;
  is_active?: boolean;
  site_ids?: string[];
  confirm_reassignment?: boolean;
}

export interface ContractorConflict {
  site_id: string;
  site_name: string;
  contractor_id: string;
  contractor_name?: string | null;
}

export const getContractors = async (params?: { active?: boolean }) => {
  const response = await client.get<{ data: Contractor[] }>('/contractors', { params });
  return response.data.data;
};

export const getContractor = async (id: string) => {
  const response = await client.get<{ data: Contractor }>(`/contractors/${id}`);
  return response.data.data;
};

export const createContractor = async (data: ContractorPayload) => {
  const response = await client.post<{ data: Contractor }>('/contractors', data);
  return response.data.data;
};

export const updateContractor = async (id: string, data: ContractorPayload) => {
  const response = await client.put<{ data: Contractor }>(`/contractors/${id}`, data);
  return response.data.data;
};

export const deactivateContractor = async (id: string) => {
  const response = await client.delete<{ data: Contractor }>(`/contractors/${id}`);
  return response.data.data;
};
