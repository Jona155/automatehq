import type { BandDistribution } from '../../types';
import { BAND_STYLES } from './bands';

interface BandDistributionBarProps {
  distribution: BandDistribution;
  className?: string;
}

// Stacked green/amber/red bar showing how many of a site's employees fall in
// each band. An all-red bar signals a systemic site problem; a mostly-green bar
// with a sliver of red signals an individual outlier.
export default function BandDistributionBar({ distribution, className = '' }: BandDistributionBarProps) {
  const total = distribution.HIGH + distribution.MID + distribution.LOW;

  if (total === 0) {
    return <div className={`h-2.5 rounded-full bg-slate-100 dark:bg-slate-700/60 ${className}`} />;
  }

  const segments: Array<{ key: keyof BandDistribution; fill: string }> = [
    { key: 'HIGH', fill: BAND_STYLES.HIGH.barFill },
    { key: 'MID', fill: BAND_STYLES.MID.barFill },
    { key: 'LOW', fill: BAND_STYLES.LOW.barFill },
  ];

  return (
    <div className={`flex h-2.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700/60 ${className}`}>
      {segments.map(({ key, fill }) => {
        const count = distribution[key];
        if (count === 0) return null;
        return (
          <div
            key={key}
            className={fill}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${key}: ${count}`}
          />
        );
      })}
    </div>
  );
}
