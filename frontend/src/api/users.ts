import client from './client';
import type { User } from '../types';

export interface CreateUserPayload {
  full_name: string;
  email: string;
  password?: string;
  role?: string;
}

export interface UpdateUserPayload {
  full_name?: string;
  email?: string;
  password?: string;
  role?: string;
}

export const getUsers = async (params?: { active?: boolean; role?: string }) => {
  const response = await client.get<{ data: User[] }>('/users', { params });
  return response.data.data;
};

export const getUser = async (id: string) => {
  const response = await client.get<{ data: User }>(`/users/${id}`);
  return response.data.data;
};

export const createUser = async (data: CreateUserPayload) => {
  const response = await client.post<{ data: User }>('/users', data);
  return response.data.data;
};

export const updateUser = async (id: string, data: UpdateUserPayload) => {
  const response = await client.put<{ data: User }>(`/users/${id}`, data);
  return response.data.data;
};

export const deleteUser = async (id: string) => {
  const response = await client.delete(`/users/${id}`);
  return response.data;
};
