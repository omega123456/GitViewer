import type { UpdateSnapshot } from './types';

export function updateStatus(state: UpdateSnapshot) {
  if (state.availability === 'development')
    return 'Updates unavailable in development builds';
  if (state.availability === 'unconfigured') return 'Updates not configured';
  switch (state.phase) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return 'Downloading update…';
    case 'ready':
      return 'Update downloaded and verified';
    case 'saving':
      return 'Saving session…';
    case 'installing':
      return 'Installing update…';
    case 'error':
      return state.error;
    case 'available':
      return 'An update is available';
    default:
      return state.lastChecked ? 'Up to date' : 'Not checked yet';
  }
}
export function updateBusy(state: UpdateSnapshot) {
  return ['checking', 'downloading', 'saving', 'installing'].includes(
    state.phase,
  );
}
