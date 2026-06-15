import client from './client';

export interface WhatsAppStatus {
  connected: boolean;
  hasAuth: boolean;
  waitingForQR: boolean;
}

export interface WhatsAppQR {
  qrDataUrl: string | null;
}

export interface WhatsAppGroup {
  chat_id: string;
  chat_name: string;
  is_linked_to_me: boolean;
}

export interface WhatsAppConfig {
  chat_id: string;
  chat_name: string | null;
  previous_month_cutoff_day: number;
  last_seen_timestamp: string | null;
  is_active: boolean;
}

export const getWhatsAppStatus = async (): Promise<WhatsAppStatus> => {
  const response = await client.get<{ data: WhatsAppStatus }>('/whatsapp/status');
  return response.data.data;
};

export const getWhatsAppQR = async (): Promise<WhatsAppQR> => {
  const response = await client.get<{ data: WhatsAppQR }>('/whatsapp/qr');
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

export const updateWhatsAppCutoffDay = async (day: number): Promise<WhatsAppConfig> => {
  const response = await client.patch<{ data: WhatsAppConfig }>('/whatsapp/config', {
    previous_month_cutoff_day: day,
  });
  return response.data.data;
};

export const unlinkWhatsAppGroup = async (): Promise<void> => {
  await client.delete('/whatsapp/link');
};

export const disconnectWhatsApp = async (): Promise<void> => {
  await client.post('/whatsapp/disconnect');
};
