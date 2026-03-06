export function getDefaultMonth(cutoffDay?: number | null): string {
  const now = new Date();
  const usePrevious = cutoffDay != null && now.getDate() < cutoffDay;
  const target = usePrevious
    ? new Date(now.getFullYear(), now.getMonth() - 1, 1)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
}
