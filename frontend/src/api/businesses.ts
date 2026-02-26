import client from './client';
import type { Business, User, Site } from '../types';

export interface CreateBusinessPayload {
  name: string;
  code: string;
}

export interface UpdateBusinessPayload {
  name?: string;
  code?: string;
}

export const getBusinesses = async (params?: { active?: boolean }) => {
  const response = await client.get<{ data: Business[] }>('/businesses', { params });
  return response.data.data;
};

export const getBusiness = async (id: string) => {
  const response = await client.get<{ data: Business }>(`/businesses/${id}`);
  return response.data.data;
};

export const createBusiness = async (data: CreateBusinessPayload) => {
  const response = await client.post<{ data: Business }>('/businesses', data);
  return response.data.data;
};

export const updateBusiness = async (id: string, data: UpdateBusinessPayload) => {
  const response = await client.put<{ data: Business }>(`/businesses/${id}`, data);
  return response.data.data;
};

export const deleteBusiness = async (id: string) => {
  const response = await client.delete(`/businesses/${id}`);
  return response.data;
};

export const activateBusiness = async (id: string) => {
  const response = await client.post(`/businesses/${id}/activate`);
  return response.data;
};

export const deactivateBusiness = async (id: string) => {
  const response = await client.post(`/businesses/${id}/deactivate`);
  return response.data;
};

export interface CreateBusinessUserPayload {
  full_name: string;
  email: string;
  password: string;
  role?: string;
}

export const getBusinessUsers = async (businessId: string) => {
  const response = await client.get<{ data: User[] }>(`/businesses/${businessId}/users`);
  return response.data.data;
};

export const createBusinessUser = async (businessId: string, data: CreateBusinessUserPayload) => {
  const response = await client.post<{ data: User }>(`/businesses/${businessId}/users`, data);
  return response.data.data;
};

export const getBusinessSites = async (businessId: string): Promise<Site[]> => {
  const response = await client.get<{ data: Site[] }>(`/businesses/${businessId}/sites`);
  return response.data.data;
};
