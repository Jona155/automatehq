import client from './client';
import type { TelegramConfig, TelegramAdminConfig, TelegramValidation, TelegramLogsResponse } from '../types';

export const getTelegramSettings = async (): Promise<TelegramConfig> => {
  const response = await client.get<{ data: TelegramConfig }>('/telegram/settings');
  return response.data.data;
};

export const updateTelegramSettings = async (
  data: { current_processing_month?: string; auto_advance_day?: number | null }
): Promise<TelegramConfig> => {
  const response = await client.patch<{ data: TelegramConfig }>('/telegram/settings', data);
  return response.data.data;
};

export const registerTelegramChat = async (
  business_id: string,
  telegram_chat_id: number
): Promise<TelegramConfig> => {
  const response = await client.post<{ data: TelegramConfig }>('/telegram/admin/register-chat', {
    business_id,
    telegram_chat_id,
  });
  return response.data.data;
};

export const getAdminTelegramConfigs = async (): Promise<TelegramAdminConfig[]> => {
  const response = await client.get<{ data: TelegramAdminConfig[] }>('/telegram/admin/configs');
  return response.data.data;
};

export const getAdminTelegramConfig = async (businessId: string): Promise<TelegramAdminConfig | null> => {
  const response = await client.get<{ data: TelegramAdminConfig | null }>(`/telegram/admin/config/${businessId}`);
  return response.data.data;
};

export const updateAdminTelegramConfig = async (
  businessId: string,
  data: Partial<Pick<TelegramAdminConfig, 'telegram_chat_id' | 'current_processing_month' | 'auto_advance_day' | 'is_active'>>
): Promise<TelegramAdminConfig> => {
  const response = await client.patch<{ data: TelegramAdminConfig }>(`/telegram/admin/config/${businessId}`, data);
  return response.data.data;
};

export const deleteAdminTelegramConfig = async (businessId: string): Promise<void> => {
  await client.delete(`/telegram/admin/config/${businessId}`);
};

export const validateTelegramChat = async (businessId: string): Promise<TelegramValidation> => {
  const response = await client.post<{ data: TelegramValidation }>(`/telegram/admin/validate-chat/${businessId}`);
  return response.data.data;
};

export const getTelegramLogs = async (businessId: string, limit = 20, offset = 0): Promise<TelegramLogsResponse> => {
  const response = await client.get<{ data: TelegramLogsResponse }>(
    `/telegram/admin/logs/${businessId}?limit=${limit}&offset=${offset}`
  );
  return response.data.data;
};

export interface TelegramPendingMessage {
  update_id: number;
  message_id: number;
  has_photo: boolean;
  telegram_username: string | null;
  telegram_user_id: number | null;
  message_timestamp: number | null;
  caption: string | null;
  text: string | null;
}

export interface TelegramPeekResult {
  messages: TelegramPendingMessage[];
  current_offset: number;
  total_pending_bot_updates: number;
  error?: string;
}

export const peekTelegramMessages = async (businessId: string): Promise<TelegramPeekResult> => {
  const response = await client.post<{ data: TelegramPeekResult }>(`/telegram/admin/peek-messages/${businessId}`);
  return response.data.data;
};

export interface TelegramDiagnosticsUpdate {
  update_id: number;
  update_type: string;
  chat_id: number | null;
  is_target_chat: boolean;
  message_type: 'photo' | 'document' | 'text' | 'other' | null;
  username: string | null;
  timestamp: number | null;
}

export interface TelegramDiagnosticsResult {
  bot: { id: number; username: string; first_name: string } | null;
  stored_offset: number;
  target_chat_id: number;
  updates: TelegramDiagnosticsUpdate[];
  summary: {
    total_updates: number;
    from_target_chat: number;
    photos_from_target_chat: number;
    other_chat_ids: number[];
  };
  diagnosis: 'no_updates' | 'chat_id_mismatch' | 'no_photos' | 'ok' | 'api_error';
  diagnosis_detail: string;
  get_updates_error: string | null;
}

export const runTelegramDiagnostics = async (businessId: string): Promise<TelegramDiagnosticsResult> => {
  const response = await client.post<{ data: TelegramDiagnosticsResult }>(`/telegram/admin/diagnostics/${businessId}`);
  return response.data.data;
};
