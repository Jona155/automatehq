import type { Band, BandDistribution } from '../../types';
import { BAND_STYLES } from './bands';

interface BandDistributionBarProps {
  distribution: BandDistribution;
  activeBand?: Band | 'all';        // when set, non-matching segments dim
  onSelect?: (band: Band) => void;  // makes segments clickable (toggle filter)
  className?: string;
}

// Stacked green/amber/red bar showing how many fall in each band. An all-red bar
// signals a systemic problem; a mostly-green bar with a red sliver an outlier.
// Optionally interactive: click a segment to drive a band filter.
export default function BandDistributionBar({
  distribution,
  activeBand = 'all',
  onSelect,
  className = '',
}: BandDistributionBarProps) {
  const total = distribution.HIGH + distribution.MID + distribution.LOW;

  if (total === 0) {
    return <div className={`h-2.5 rounded-full bg-slate-100 dark:bg-slate-700/60 ${className}`} />;
  }

  const segments: Array<{ key: Band; fill: string }> = [
    { key: 'HIGH', fill: BAND_STYLES.HIGH.barFill },
    { key: 'MID', fill: BAND_STYLES.MID.barFill },
    { key: 'LOW', fill: BAND_STYLES.LOW.barFill },
  ];

  return (
    <div className={`flex h-2.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700/60 ${className}`}>
      {segments.map(({ key, fill }) => {
        const count = distribution[key];
        if (count === 0) return null;
        const dimmed = activeBand !== 'all' && activeBand !== key;
        const clickable = Boolean(onSelect);
        return (
          <div
            key={key}
            className={`${fill} transition-opacity ${dimmed ? 'opacity-30' : 'opacity-100'} ${
              clickable ? 'cursor-pointer' : ''
            }`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${BAND_STYLES[key].label}: ${count}`}
            onClick={onSelect ? () => onSelect(key) : undefined}
          />
        );
      })}
    </div>
  );
}
