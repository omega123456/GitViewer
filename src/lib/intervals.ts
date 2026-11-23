import type { Duration } from 'date-fns';
import { keysOf } from './options';
import type { Settings } from './types';
export interface IntervalChoice {
  label: string;
  every: Duration | null;
}
type FetchInterval = Settings['autoFetchInterval'];
type UpdateInterval = Settings['updateCheckInterval'];
export const fetchIntervals: Record<FetchInterval, IntervalChoice> = {
  off: { label: 'Off', every: null },
  '30s': { label: 'Every 30 seconds', every: { seconds: 30 } },
  '1m': { label: 'Every minute', every: { minutes: 1 } },
  '5m': { label: 'Every 5 minutes', every: { minutes: 5 } },
  '10m': { label: 'Every 10 minutes', every: { minutes: 10 } },
  '15m': { label: 'Every 15 minutes', every: { minutes: 15 } },
  '30m': { label: 'Every 30 minutes', every: { minutes: 30 } },
};
export const updateCheckIntervals: Record<UpdateInterval, IntervalChoice> = {
  '1h': { label: 'Every hour', every: { hours: 1 } },
  '5h': { label: 'Every 5 hours', every: { hours: 5 } },
  '1d': { label: 'Every day', every: { days: 1 } },
  '7d': { label: 'Every 7 days', every: { days: 7 } },
  off: { label: 'Off', every: null },
};
export function intervalLabels<Key extends string>(
  table: Record<Key, IntervalChoice>,
) {
  const labels: Partial<Record<Key, string>> = {};
  for (const key of keysOf(table)) labels[key] = table[key].label;
  return labels;
}
