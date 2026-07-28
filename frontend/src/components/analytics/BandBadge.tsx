import type { Band } from '../../types';
import { bandStyle } from './bands';

interface BandBadgeProps {
  band: Band | null;
  className?: string;
}

// Small pill showing the performance band in its color.
export default function BandBadge({ band, className = '' }: BandBadgeProps) {
  const style = bandStyle(band);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${style.badgeBg} ${style.badgeText} ${className}`}
    >
      {style.label}
    </span>
  );
}
