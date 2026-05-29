'use client';

import { useCallback, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface MetricPoint {
  at: string;
  sizeGb: number;
  tableBloatGb: number;
  indexBloatGb: number;
  totalBloatGb: number;
  reclaimableGb: number | null;
}

type SeriesKey =
  | 'sizeGb'
  | 'tableBloatGb'
  | 'indexBloatGb'
  | 'totalBloatGb'
  | 'reclaimableGb';

const BASE_SERIES: {
  dataKey: SeriesKey;
  name: string;
  stroke: string;
  strokeDasharray?: string;
}[] = [
  { dataKey: 'sizeGb', name: 'Database size', stroke: '#3d8bfd' },
  { dataKey: 'tableBloatGb', name: 'Table bloat', stroke: '#f5a524' },
  { dataKey: 'indexBloatGb', name: 'Index bloat', stroke: '#e07a5f' },
  { dataKey: 'totalBloatGb', name: 'Total bloat', stroke: '#c77dff', strokeDasharray: '6 3' },
];

const RECLAIMABLE_SERIES = {
  dataKey: 'reclaimableGb' as const,
  name: 'Reclaimable',
  stroke: '#2dd4bf',
  strokeDasharray: '4 4',
};

export function MetricsChart({
  data,
  showReclaimable = false,
}: {
  data: MetricPoint[];
  showReclaimable?: boolean;
}) {
  const series = showReclaimable
    ? [...BASE_SERIES, RECLAIMABLE_SERIES]
    : BASE_SERIES;
  const seriesLabels = Object.fromEntries(series.map((s) => [s.dataKey, s.name])) as Record<
    SeriesKey,
    string
  >;

  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set());

  const toggle = useCallback((key: SeriesKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (!data.length) {
    return <p className="muted">No metrics yet — run an initial check or scheduled job.</p>;
  }

  return (
    <div className="chart-block">
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2d3a4f" strokeDasharray="3 3" />
            <XAxis
              dataKey="at"
              tick={{ fill: '#8b9cb3', fontSize: 11 }}
              tickFormatter={(v) =>
                new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              }
            />
            <YAxis
              tick={{ fill: '#8b9cb3', fontSize: 11 }}
              tickFormatter={(v) => `${v} GB`}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: '#1a2332',
                border: '1px solid #2d3a4f',
                borderRadius: 6,
              }}
              labelFormatter={(v) => new Date(v).toLocaleString()}
              formatter={(value: number, name: string) => {
                if (hidden.has(name as SeriesKey)) return null;
                if (value == null || Number.isNaN(value)) return null;
                return [
                  `${value.toFixed(2)} GB`,
                  seriesLabels[name as SeriesKey] ?? name,
                ];
              }}
            />
            {series.map((s) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.stroke}
                strokeDasharray={s.strokeDasharray}
                dot={false}
                strokeWidth={2}
                connectNulls={s.dataKey === 'reclaimableGb'}
                hide={hidden.has(s.dataKey)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend" role="group" aria-label="Chart series">
        {series.map((s) => {
          const off = hidden.has(s.dataKey);
          return (
            <button
              key={s.dataKey}
              type="button"
              className={`chart-legend-item${off ? ' is-off' : ''}`}
              aria-pressed={!off}
              onClick={() => toggle(s.dataKey)}
            >
              <span
                className={`chart-legend-swatch${s.strokeDasharray ? ' is-dashed' : ''}`}
                style={
                  s.strokeDasharray
                    ? { borderTop: `3px dashed ${s.stroke}` }
                    : { background: s.stroke }
                }
                aria-hidden
              />
              <span className="chart-legend-label">{s.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
