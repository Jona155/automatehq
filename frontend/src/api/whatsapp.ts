import client from './client';

export interface WhatsAppStatus {
  connected: boolean;
  hasAuth: boolean;
}

export interface WhatsAppGroup {
  chat_id: string;
  chat_name: string;
  is_linked_to_me: boolean;
}

export interface WhatsAppConfig {
  chat_id: string;
  chat_name: string | null;
  current_processing_month: string | null;
  auto_advance_day: number | null;
  last_seen_timestamp: string | null;
  is_active: boolean;
}

export const getWhatsAppStatus = async (): Promise<WhatsAppStatus> => {
  const response = await client.get<{ data: WhatsAppStatus }>('/whatsapp/status');
  return response.data.data;
};

export const getWhatsAppConfig = async (): Promise<WhatsAppConfig | null> => {
  const response = await client.get<{ data: WhatsAppConfig | null }>('/whatsapp/config');
  return response.data.data;
};

export const getWhatsAppGroups = async (): Promise<WhatsAppGroup[]> => {
  const response = await client.get<{ data: WhatsAppGroup[] }>('/whatsapp/groups');
  return response.data.data;
};

export const linkWhatsAppGroup = async (chat_id: string): Promise<WhatsAppConfig> => {
  const response = await client.post<{ data: WhatsAppConfig }>('/whatsapp/link', { chat_id });
  return response.data.data;
};

export const unlinkWhatsAppGroup = async (): Promise<void> => {
  await client.delete('/whatsapp/link');
};
