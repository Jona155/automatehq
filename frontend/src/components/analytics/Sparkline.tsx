import { useId } from 'react';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from 'recharts';
import type { TrendPoint } from '../../types';

interface SparklineProps {
  trend: TrendPoint[];
  color?: string;
  height?: number;
  showTooltip?: boolean;
  className?: string;
}

// Clean mini trend: smooth line over a soft gradient area, no axes/grid/dots.
// Renders nothing for a single point — a sparkline needs at least two.
export default function Sparkline({
  trend,
  color = '#2b9dee',
  height = 36,
  showTooltip = false,
  className = '',
}: SparklineProps) {
  const gradientId = useId();
  if (!trend || trend.length < 2) return null;
  const data = trend.map((t) => ({ month: t.month, value: t.utilization }));

  return (
    <div className={className} style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin - 8', 'dataMax + 8']} />
          {showTooltip && (
            <Tooltip
              formatter={(value) => [typeof value === 'number' ? `${Math.round(value)}%` : '—', 'ניצולת'] as [string, string]}
              labelFormatter={(l) => String(l)}
              contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 8px 20px rgba(15,23,42,0.12)', fontSize: 12 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={showTooltip ? { r: 3 } : false}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
