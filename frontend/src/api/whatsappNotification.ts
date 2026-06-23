import client from './client';

export interface WhatsAppNotificationSettings {
  enabled: boolean;
  start_day: number;
  end_day: number;
  destination_user_ids: string[];
}

export const getWhatsAppNotificationSettings = async (): Promise<WhatsAppNotificationSettings> => {
  const response = await client.get<{ data: WhatsAppNotificationSettings }>(
    '/whatsapp/notification-settings'
  );
  return response.data.data;
};

export const updateWhatsAppNotificationSettings = async (
  payload: WhatsAppNotificationSettings
): Promise<WhatsAppNotificationSettings> => {
  const response = await client.put<{ data: WhatsAppNotificationSettings }>(
    '/whatsapp/notification-settings',
    payload
  );
  return response.data.data;
};
