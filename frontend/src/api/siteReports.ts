import client from './client';

export type ReportType = 'summary' | 'salary';
export type ReportCellKind = 'input' | 'calculated' | 'protected';
export type ReportCellValue = string | number | null;

export interface ReportDayValue {
  hours: number | null;
  status: string | null;
}

export interface ReportModelCell {
  row: number;
  col: number;
  value: ReportCellValue;
  kind: ReportCellKind;
  employee_id?: string;
  day?: number;
  formula?: string;
  note?: string;
  fill?: string;
  bold?: boolean;
  number_format?: string;
}

export interface ReportModelEmployee {
  id: string;
  full_name: string;
  passport_id: string | null;
  row?: number;
  col?: number;
}

export interface ReportModel {
  report_type: ReportType;
  sheet_title: string;
  rtl: boolean;
  row_count: number;
  col_count: number;
  col_widths: Record<string, number>;
  cells: ReportModelCell[];
  orientation: 'employees_as_columns' | 'employees_as_rows';
  days_in_month: number;
  employees: ReportModelEmployee[];
  total_row?: number;
  instruction_row?: number;
  /** Summary only: employee id -> day -> text shown for a day worked at another site. */
  other_site_labels?: Record<string, Record<string, string>>;
}

export interface ReportAdjustmentInfo {
  employee_id: string;
  day: number;
  value: ReportDayValue;
  source: ReportDayValue;
  conflict: boolean;
  updated_by_name: string | null;
  updated_at: string | null;
}

export interface ReportCellText {
  employee_id: string;
  day: number;
  text: string;
}

export interface SiteReportPayload {
  site: { id: string; name: string };
  processing_month: string;
  report_type: ReportType;
  revision: number;
  model: ReportModel;
  adjustments: ReportAdjustmentInfo[];
  notes: ReportCellText[];
  day_comments: ReportCellText[];
  orphan_adjustments: { employee_id: string; day: number; value: ReportDayValue }[];
  status_labels: Record<string, string>;
  employee_count: number;
  has_unapproved_cards: boolean;
  load_options: { approved_only: boolean; include_inactive: boolean };
  /** Whether any employee in this report worked at another site this month. */
  has_other_site_days: boolean;
  /** Whether those days name the other site (preview and download alike). */
  show_other_site_names: boolean;
}

export interface ReportCellChange {
  employee_id: string;
  day: number;
  value?: ReportCellValue;
  reset?: boolean;
}

export interface ReportSaveError {
  employee_id: string | null;
  day: number | null;
  message: string;
  field?: string;
}

const toProcessingMonth = (month: string) => (/^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month);

let enabledPromise: Promise<boolean> | null = null;

/** Whether the report editor is switched on for this deployment (cached per page load). */
export const getReportEditorEnabled = (): Promise<boolean> => {
  if (!enabledPromise) {
    enabledPromise = client
      .get<{ data: { enabled: boolean } }>('/sites/report-editor/status')
      .then((response) => Boolean(response.data.data?.enabled))
      .catch(() => {
        enabledPromise = null;
        return false;
      });
  }
  return enabledPromise;
};

export const getSiteReport = async (
  siteId: string,
  reportType: ReportType,
  month: string,
  options?: { showOtherSiteNames?: boolean },
) => {
  const response = await client.get<{ data: SiteReportPayload }>(`/sites/${siteId}/reports/${reportType}`, {
    params: {
      processing_month: toProcessingMonth(month),
      show_other_site_names: options?.showOtherSiteNames ? 'true' : 'false',
    },
  });
  return response.data.data;
};

export const saveSiteReport = async (
  siteId: string,
  reportType: ReportType,
  month: string,
  body: { base_revision: number; cells: ReportCellChange[]; notes: ReportCellText[]; show_other_site_names?: boolean },
) => {
  const response = await client.put<{ data: SiteReportPayload }>(`/sites/${siteId}/reports/${reportType}`, {
    processing_month: toProcessingMonth(month),
    ...body,
  });
  return response.data.data;
};
