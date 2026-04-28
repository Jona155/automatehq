import client from './client';
import type { SiteTariffImportRow, SiteTariffImportSummary } from '../types';

export interface SiteTariffImportPreviewResponse {
  summary: SiteTariffImportSummary;
  rows: SiteTariffImportRow[];
}

export interface SiteTariffImportFieldChange<T> {
  old: T | null;
  new: T | null;
}

export interface SiteTariffImportAppliedRow {
  site_id: string;
  site_name: string;
  changes: {
    tariff?: SiteTariffImportFieldChange<number>;
    phone?: SiteTariffImportFieldChange<string>;
    emails?: SiteTariffImportFieldChange<string[]>;
  };
}

export interface SiteTariffImportApplyResponse {
  summary: SiteTariffImportSummary;
  rows: SiteTariffImportRow[];
  applied: SiteTariffImportAppliedRow[];
}

export const previewSiteTariffImport = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await client.post<{ data: SiteTariffImportPreviewResponse }>(
    '/sites/tariff-import/preview',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return response.data.data;
};

export const applySiteTariffImport = async (rows: SiteTariffImportRow[]) => {
  const response = await client.post<{ data: SiteTariffImportApplyResponse }>(
    '/sites/tariff-import/apply',
    { rows }
  );

  return response.data.data;
};

export const downloadSiteTariffsExport = async (
  options?: { include_inactive?: boolean }
) => {
  const response = await client.get('/sites/tariff-import/export', {
    params: {
      include_inactive: options?.include_inactive === false ? 'false' : 'true',
    },
    responseType: 'blob',
  });
  return response.data as Blob;
};
