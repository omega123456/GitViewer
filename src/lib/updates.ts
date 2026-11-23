import type { UpdateSnapshot } from './types';

const unavailableStatus: Partial<
  Record<UpdateSnapshot['availability'], string>
> = {
  development: 'Updates unavailable in development builds',
  unconfigured: 'Updates not configured',
};
const phaseStatus: Record<
  UpdateSnapshot['phase'],
  (state: UpdateSnapshot) => string | null
> = {
  idle: (state) => (state.lastChecked ? 'Up to date' : 'Not checked yet'),
  checking: () => 'Checking for updates…',
  available: () => 'An update is available',
  downloading: () => 'Downloading update…',
  ready: () => 'Update downloaded and verified',
  saving: () => 'Saving session…',
  installing: () => 'Installing update…',
  error: (state) => state.error,
};
export function updateStatus(state: UpdateSnapshot) {
  const unavailable = unavailableStatus[state.availability];
  if (unavailable) return unavailable;
  return phaseStatus[state.phase](state);
}
export function updateBusy(state: UpdateSnapshot) {
  return ['checking', 'downloading', 'saving', 'installing'].includes(
    state.phase,
  );
}
