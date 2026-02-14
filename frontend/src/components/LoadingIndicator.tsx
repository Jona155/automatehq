interface LoadingIndicatorProps {
  title?: string;
  subtitle?: string;
  iconClassName?: string;
  className?: string;
}

export default function LoadingIndicator({
  title = 'טוען...',
  subtitle,
  iconClassName = 'text-primary',
  className = '',
}: LoadingIndicatorProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-8 text-center ${className}`}>
      <span className={`material-symbols-outlined text-4xl animate-spin ${iconClassName}`}>
        progress_activity
      </span>
      <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
  );
}
