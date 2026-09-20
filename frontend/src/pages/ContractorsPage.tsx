import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AxiosError } from 'axios';

import {
  createContractor,
  deactivateContractor,
  getContractors,
  updateContractor,
  type ContractorConflict,
  type ContractorPayload,
} from '../api/contractors';
import { downloadMonthlySummaryBatch, getSites } from '../api/sites';
import LoadingIndicator from '../components/LoadingIndicator';
import Modal from '../components/Modal';
import MonthPicker from '../components/MonthPicker';
import SearchableMultiSelect from '../components/SearchableMultiSelect';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from '../hooks/useToast';
import type { Contractor, Site } from '../types';
import { downloadBlobFile } from '../utils/fileDownload';
import { getDefaultMonth } from '../utils/monthUtils';

type StatusFilter = 'all' | 'active' | 'inactive';
type SortField = 'name' | 'site_count' | 'employee_count' | 'is_active';
type SortOrder = 'asc' | 'desc';
type ApiErrorBody = {
  message?: string;
  data?: { conflicts?: ContractorConflict[] };
};

const EMPTY_FORM = {
  name: '',
  email: '',
  phone_number: '',
  address: '',
  site_ids: [] as string[],
};

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
      active
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? 'פעיל' : 'לא פעיל'}
    </span>
  );
}

function SitesTooltip({ sites }: { sites: Contractor['sites'] }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  const cancelHide = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const show = () => {
    cancelHide();
    if (!triggerRef.current || sites.length === 0) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const openUpward = window.innerHeight - rect.bottom < 240 && rect.top > 240;
    setPosition(openUpward
      ? { left, bottom: window.innerHeight - rect.top + 6 }
      : { left, top: rect.bottom + 6 });
  };

  const hide = () => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => setPosition(null), 120);
  };

  useEffect(() => () => cancelHide(), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex items-center gap-1 font-medium ${sites.length ? 'cursor-help hover:text-primary focus:text-primary' : 'cursor-default'}`}
        aria-label={sites.length ? `${sites.length} אתרים. הצג רשימה` : 'ללא אתרים'}
      >
        {sites.length}
        {sites.length > 0 && <span className="material-symbols-outlined text-sm text-slate-400">info</span>}
      </button>
      {position && createPortal(
        <div
          dir="rtl"
          role="tooltip"
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
          className="fixed z-[120] w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl shadow-slate-900/10 dark:shadow-black/30 overflow-hidden"
          style={position}
        >
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200">
            אתרים משויכים ({sites.length})
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {sites.map((site) => (
              <div key={site.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                <span className={`size-1.5 shrink-0 rounded-full ${site.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <span className="min-w-0 flex-1">{site.site_name}</span>
                {site.site_code && <span className="shrink-0 text-[11px] text-slate-400">{site.site_code}</span>}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default function ContractorsPage() {
  const { isAuthenticated, user } = useAuth();
  const { isAdmin } = usePermissions();
  const { showToast, ToastContainer } = useToast();
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedSiteSearch, setAssignedSiteSearch] = useState('');
  const [summaryContractor, setSummaryContractor] = useState<Contractor | null>(null);
  const [summaryMonth, setSummaryMonth] = useState(() => getDefaultMonth(user?.business?.default_month_cutoff_day));
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSummaryExporting, setIsSummaryExporting] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [contractorData, siteData] = await Promise.all([
        getContractors(),
        getSites({ active: false }),
      ]);
      setContractors(contractorData);
      setSites(siteData);
      setLoadError(null);
    } catch (error) {
      console.error('Failed to load contractors:', error);
      setLoadError('שגיאה בטעינת הקבלנים');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) loadData();
  }, [isAuthenticated]);

  const ownerBySiteId = useMemo(() => {
    const owners = new Map<string, Contractor>();
    contractors.forEach((contractor) => {
      contractor.sites.forEach((site) => owners.set(site.id, contractor));
    });
    return owners;
  }, [contractors]);

  const siteOptions = useMemo(() => sites
    .slice()
    .sort((a, b) => a.site_name.localeCompare(b.site_name, 'he'))
    .map((site) => {
      const owner = ownerBySiteId.get(site.id);
      const details = [
        site.site_code || null,
        site.is_active ? null : 'לא פעיל',
        owner && owner.id !== editing?.id ? `משויך ל-${owner.name}` : null,
      ].filter(Boolean).join(' · ');
      return {
        value: site.id,
        label: details ? `${site.site_name} (${details})` : site.site_name,
      };
    }), [sites, ownerBySiteId, editing]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contractors.filter((contractor) => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' ? contractor.is_active : !contractor.is_active);
      const haystack = [contractor.name, contractor.email, contractor.phone_number, contractor.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [contractors, search, statusFilter]);

  const sortedContractors = useMemo(() => [...filtered].sort((a, b) => {
    let comparison = 0;
    if (sortField === 'name') comparison = a.name.localeCompare(b.name, 'he');
    if (sortField === 'site_count') comparison = a.site_count - b.site_count;
    if (sortField === 'employee_count') comparison = a.employee_count - b.employee_count;
    if (sortField === 'is_active') comparison = Number(a.is_active) - Number(b.is_active);
    return sortOrder === 'asc' ? comparison : -comparison;
  }), [filtered, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedContractors.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const visibleContractors = sortedContractors.slice((page - 1) * pageSize, page * pageSize);
  const activeCount = contractors.filter((contractor) => contractor.is_active).length;
  const assignedSites = new Set(contractors.flatMap((contractor) => contractor.sites.map((site) => site.id))).size;
  const selectedSites = useMemo(() => {
    const selectedIds = new Set(form.site_ids);
    return sites
      .filter((site) => selectedIds.has(site.id))
      .sort((a, b) => a.site_name.localeCompare(b.site_name, 'he'));
  }, [form.site_ids, sites]);
  const visibleSelectedSites = useMemo(() => {
    const query = assignedSiteSearch.trim().toLowerCase();
    if (!query) return selectedSites;
    return selectedSites.filter((site) =>
      `${site.site_name} ${site.site_code || ''}`.toLowerCase().includes(query)
    );
  }, [assignedSiteSearch, selectedSites]);

  useEffect(() => setCurrentPage(1), [search, statusFilter, pageSize]);

  const changeSort = (field: SortField) => {
    if (sortField === field) setSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortIcon = (field: SortField) => (
    <span className="material-symbols-outlined text-sm text-slate-400">
      {sortField !== field ? 'unfold_more' : sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
    </span>
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setAssignedSiteSearch('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (contractor: Contractor) => {
    setEditing(contractor);
    setForm({
      name: contractor.name,
      email: contractor.email || '',
      phone_number: contractor.phone_number ? `+${contractor.phone_number}` : '',
      address: contractor.address || '',
      site_ids: contractor.sites.map((site) => site.id),
    });
    setAssignedSiteSearch('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const submit = async (event: React.FormEvent, confirmReassignment = false) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError('שם הקבלן הוא שדה חובה');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    const payload: ContractorPayload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone_number: form.phone_number.trim() || null,
      address: form.address.trim() || null,
      site_ids: form.site_ids,
      confirm_reassignment: confirmReassignment,
    };
    try {
      if (editing) await updateContractor(editing.id, payload);
      else await createContractor(payload);
      setIsModalOpen(false);
      showToast(editing ? 'הקבלן עודכן בהצלחה' : 'הקבלן נוצר בהצלחה', 'success');
      await loadData();
    } catch (rawError) {
      const error = rawError as AxiosError<ApiErrorBody>;
      const conflicts = error.response?.data?.data?.conflicts;
      if (error.response?.status === 409 && conflicts?.length && !confirmReassignment) {
        const lines = conflicts.map((conflict) =>
          `${conflict.site_name} (${conflict.contractor_name || 'קבלן אחר'})`
        ).join('\n');
        if (window.confirm(`האתרים הבאים כבר משויכים לקבלן אחר:\n${lines}\n\nלהעביר אותם לקבלן הנוכחי?`)) {
          await submit(event, true);
        }
      } else {
        setFormError(error.response?.data?.message || 'שגיאה בשמירת הקבלן');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (contractor: Contractor) => {
    if (contractor.site_count > 0) {
      showToast('יש להסיר את שיוך האתרים לפני השבתת הקבלן', 'error');
      return;
    }
    if (!window.confirm(`להשבית את ${contractor.name}?`)) return;
    try {
      await deactivateContractor(contractor.id);
      showToast('הקבלן הושבת בהצלחה', 'success');
      await loadData();
    } catch (rawError) {
      const error = rawError as AxiosError<ApiErrorBody>;
      showToast(error.response?.data?.message || 'שגיאה בהשבתת הקבלן', 'error');
    }
  };

  const handleActivate = async (contractor: Contractor) => {
    try {
      await updateContractor(contractor.id, { is_active: true });
      showToast('הקבלן הופעל מחדש', 'success');
      await loadData();
    } catch (rawError) {
      const error = rawError as AxiosError<ApiErrorBody>;
      showToast(error.response?.data?.message || 'שגיאה בהפעלת הקבלן', 'error');
    }
  };

  const copyContactDetail = async (value: string, label: string) => {
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value.trim());
      showToast(`${label} הועתק`, 'success');
    } catch {
      showToast(`לא ניתן להעתיק את ${label}`, 'error');
    }
  };

  const openSummaryExport = (contractor: Contractor) => {
    setSummaryContractor(contractor);
    setSummaryMonth(getDefaultMonth(user?.business?.default_month_cutoff_day));
    setSummaryError(null);
  };

  const downloadContractorSummary = async () => {
    if (!summaryContractor || !summaryMonth) {
      setSummaryError('יש לבחור חודש לייצוא.');
      return;
    }
    const activeSiteIds = summaryContractor.sites
      .filter((site) => site.is_active)
      .map((site) => site.id);
    if (activeSiteIds.length === 0) {
      setSummaryError('אין לקבלן אתרים פעילים לייצוא.');
      return;
    }

    setIsSummaryExporting(true);
    setSummaryError(null);
    try {
      const blob = await downloadMonthlySummaryBatch(summaryMonth, {
        approved_only: false,
        include_inactive: false,
        include_inactive_sites: false,
        site_ids: activeSiteIds,
      });
      const safeName = summaryContractor.name.replace(/[\\/:*?"<>|]+/g, '-');
      downloadBlobFile(blob, `monthly_summary_${safeName}_${summaryMonth}.xlsx`);
      setSummaryContractor(null);
    } catch (error) {
      console.error('Failed to export contractor summary:', error);
      setSummaryError('שגיאה בהורדת סיכום הקבלן');
    } finally {
      setIsSummaryExporting(false);
    }
  };

  if (isLoading) return <LoadingIndicator />;

  return (
    <div className="flex flex-col gap-5">
      <ToastContainer />
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">ניהול קבלנים</h1>
            <span className="text-xs text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
              {contractors.length}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">נהל קבלנים ואת האתרים שפועלים תחתיהם</p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="h-9 px-4 inline-flex items-center gap-2 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg">
            <span className="material-symbols-outlined text-base">add</span>
            יצירת קבלן
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          ['סה״כ קבלנים', contractors.length, 'handshake'],
          ['קבלנים פעילים', activeCount, 'check_circle'],
          ['אתרים משויכים', assignedSites, 'apartment'],
        ].map(([label, value, icon]) => (
          <div key={label} className="flex items-center gap-3 p-4 bg-white dark:bg-[#1a2a35] border border-slate-200/70 dark:border-slate-700/60 rounded-xl">
            <span className="material-symbols-outlined text-primary">{icon}</span>
            <div><div className="text-2xl font-semibold text-slate-900 dark:text-white">{value}</div><div className="text-xs text-slate-500 dark:text-slate-400">{label}</div></div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 p-3 bg-white dark:bg-[#1a2a35] border border-slate-200/70 dark:border-slate-700/60 rounded-xl">
        <div className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-900/60 rounded-lg">
          {(['all', 'active', 'inactive'] as StatusFilter[]).map((status) => (
            <button key={status} onClick={() => setStatusFilter(status)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${statusFilter === status ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
              {status === 'all' ? 'הכל' : status === 'active' ? 'פעילים' : 'לא פעילים'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-56">
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-lg text-slate-400">search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש לפי שם או פרטי קשר…" className="w-full pr-10 pl-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary/40" />
        </div>
      </div>

      {loadError ? (
        <div className="p-6 text-center text-red-600 bg-red-50 dark:bg-red-500/10 rounded-xl">{loadError}</div>
      ) : (
        <div className="overflow-hidden bg-white dark:bg-[#1a2a35] border border-slate-200/70 dark:border-slate-700/60 rounded-xl">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm text-right">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[24%]" />
                <col className="w-[11%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                {isAdmin && <col className="w-[14%]" />}
              </colgroup>
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 dark:text-slate-400">
                <tr><th className="px-4 py-3 font-medium"><button onClick={() => changeSort('name')} className="inline-flex items-center gap-1">שם קבלן {sortIcon('name')}</button></th><th className="px-4 py-3 font-medium">כתובת</th><th className="px-4 py-3 font-medium"><button onClick={() => changeSort('site_count')} className="inline-flex items-center gap-1">אתרים {sortIcon('site_count')}</button></th><th className="px-4 py-3 font-medium"><button onClick={() => changeSort('employee_count')} className="inline-flex items-center gap-1">עובדים {sortIcon('employee_count')}</button></th><th className="px-4 py-3 font-medium"><button onClick={() => changeSort('is_active')} className="inline-flex items-center gap-1">סטטוס {sortIcon('is_active')}</button></th>{isAdmin && <th className="px-4 py-3 font-medium">פעולות</th>}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleContractors.map((contractor) => (
                  <tr key={contractor.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{contractor.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300 max-w-56 truncate">{contractor.address || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300"><SitesTooltip sites={contractor.sites} /></td>
                    <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200 tabular-nums">{contractor.employee_count}</td>
                    <td className="px-4 py-3"><StatusPill active={contractor.is_active} /></td>
                    {isAdmin && <td className="px-4 py-3"><div className="flex items-center gap-1"><button onClick={() => openSummaryExport(contractor)} disabled={!contractor.sites.some((site) => site.is_active)} title={contractor.sites.some((site) => site.is_active) ? 'הורדת סיכום אתרים' : 'אין אתרים פעילים לייצוא'} className="p-2 rounded-md text-primary hover:bg-primary/10 disabled:text-slate-300 dark:disabled:text-slate-600 disabled:hover:bg-transparent disabled:cursor-not-allowed"><span className="material-symbols-outlined text-lg">download</span></button><button onClick={() => openEdit(contractor)} title="עריכה" className="p-2 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"><span className="material-symbols-outlined text-lg">edit</span></button>{contractor.is_active ? <button onClick={() => handleDeactivate(contractor)} title="השבתה" className="p-2 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"><span className="material-symbols-outlined text-lg">block</span></button> : <button onClick={() => handleActivate(contractor)} title="הפעלה מחדש" className="p-2 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"><span className="material-symbols-outlined text-lg">check_circle</span></button>}</div></td>}
                  </tr>
                ))}
                {visibleContractors.length === 0 && <tr><td colSpan={isAdmin ? 6 : 5} className="px-4 py-12 text-center text-slate-400">לא נמצאו קבלנים</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select>
            <div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setCurrentPage(page - 1)} className="p-1 disabled:opacity-30"><span className="material-symbols-outlined text-lg">chevron_right</span></button><span>עמוד {page} מתוך {totalPages}</span><button disabled={page >= totalPages} onClick={() => setCurrentPage(page + 1)} className="p-1 disabled:opacity-30"><span className="material-symbols-outlined text-lg">chevron_left</span></button></div>
          </div>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => !isSubmitting && setIsModalOpen(false)} title={editing ? 'עריכת קבלן' : 'יצירת קבלן'} maxWidth="lg">
        <form onSubmit={submit} className="space-y-4">
          <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">שם קבלן *</label><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary/40" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">אימייל</label>
              <div className="flex gap-2">
                <input type="email" dir="ltr" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary/40" />
                <button type="button" disabled={!form.email.trim()} onClick={() => copyContactDetail(form.email, 'האימייל')} title="העתקת אימייל" aria-label="העתקת אימייל" className="shrink-0 size-10 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="material-symbols-outlined text-lg">content_copy</span>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">טלפון</label>
              <div className="flex gap-2">
                <input dir="ltr" value={form.phone_number} onChange={(event) => setForm({ ...form, phone_number: event.target.value })} className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary/40" />
                <button type="button" disabled={!form.phone_number.trim()} onClick={() => copyContactDetail(form.phone_number, 'הטלפון')} title="העתקת טלפון" aria-label="העתקת טלפון" className="shrink-0 size-10 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="material-symbols-outlined text-lg">content_copy</span>
                </button>
              </div>
            </div>
          </div>
          <div><label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">כתובת</label><textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary/40 resize-y" /></div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">אתרים משויכים</label>
            {selectedSites.length > 0 && (
              <div className="mb-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">נבחרו {selectedSites.length} אתרים</span>
                  {selectedSites.length > 6 && (
                    <div className="relative w-48 max-w-[60%]">
                      <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-400">search</span>
                      <input value={assignedSiteSearch} onChange={(event) => setAssignedSiteSearch(event.target.value)} placeholder="חיפוש בנבחרים…" className="w-full pr-7 pl-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-primary/50" />
                    </div>
                  )}
                </div>
                <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleSelectedSites.map((site) => (
                    <div key={site.id} className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200">
                      <span className={`size-1.5 shrink-0 rounded-full ${site.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="min-w-0 flex-1 truncate">{site.site_name}</span>
                      {site.site_code && <span className="shrink-0 text-[11px] text-slate-400">{site.site_code}</span>}
                      <button type="button" onClick={() => setForm((current) => ({ ...current, site_ids: current.site_ids.filter((id) => id !== site.id) }))} className="shrink-0 inline-flex items-center justify-center size-6 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title={`הסר את ${site.site_name}`} aria-label={`הסר את ${site.site_name}`}>
                        <span className="material-symbols-outlined text-base">close</span>
                      </button>
                    </div>
                  ))}
                  {visibleSelectedSites.length === 0 && <div className="px-3 py-5 text-center text-xs text-slate-400">לא נמצאו אתרים ברשימה</div>}
                </div>
              </div>
            )}
            <SearchableMultiSelect options={siteOptions} selected={form.site_ids} onChange={(site_ids) => setForm({ ...form, site_ids })} searchPlaceholder="חיפוש אתרים…" icon="apartment" allLabel="נקה בחירה" />
            <p className="mt-1.5 text-xs text-slate-500">ניתן להסיר אתר מהרשימה למעלה. בחירת אתר שמשויך לקבלן אחר תדרוש אישור להעברה.</p>
          </div>
          {formError && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-sm text-red-600 dark:text-red-300">{formError}</div>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" disabled={isSubmitting} onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">ביטול</button><button type="submit" disabled={isSubmitting} className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white disabled:opacity-60">{isSubmitting ? 'שומר…' : 'שמירה'}</button></div>
        </form>
      </Modal>

      <Modal
        isOpen={summaryContractor !== null}
        onClose={() => !isSummaryExporting && setSummaryContractor(null)}
        title="הורדת סיכום אתרי קבלן (Excel)"
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4" dir="rtl">
          {summaryError && !isSummaryExporting && (
            <div className="p-3 rounded-lg border border-red-100 bg-red-50 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {summaryError}
            </div>
          )}
          {isSummaryExporting ? (
            <LoadingIndicator title="מכין קובץ Excel..." subtitle="התהליך יכול לקחת עד דקה" />
          ) : summaryContractor && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  <span className="material-symbols-outlined text-lg text-primary">handshake</span>
                  {summaryContractor.name}
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  הקובץ יכלול {summaryContractor.sites.filter((site) => site.is_active).length} אתרים פעילים המשויכים לקבלן.
                </p>
              </div>
              <div>
                <label className="mb-3 block text-sm font-semibold text-slate-700 dark:text-slate-300">חודש לייצוא</label>
                <div className="inline-flex">
                  <MonthPicker
                    value={summaryMonth}
                    onChange={setSummaryMonth}
                    storageKey="contractor_summary_export_month"
                  />
                </div>
              </div>
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end">
                <button type="button" onClick={() => setSummaryContractor(null)} className="rounded-lg px-4 py-2 font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700">
                  ביטול
                </button>
                <button type="button" onClick={downloadContractorSummary} className="rounded-lg bg-primary px-6 py-2 font-bold text-white shadow-lg shadow-primary/30 transition-colors hover:bg-primary/90">
                  הורד Excel
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
