import { useEffect, useState } from 'react';
import { getReportEditorEnabled } from '../api/siteReports';

/** True once the server confirms the report editor is switched on. */
export function useReportEditorEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getReportEditorEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
