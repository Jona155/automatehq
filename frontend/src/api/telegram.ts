import client from './client';
import type { TelegramConfig } from '../types';

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
