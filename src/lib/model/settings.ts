import type { TabLayout } from '../../stores/layout';
export interface UpdateSnapshot {
  currentVersion: string;
  availability: 'enabled' | 'development' | 'unconfigured';
  available: {
    version: string;
    notes: string | null;
    date: string | null;
  } | null;
  lastChecked: string | null;
  phase:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'saving'
    | 'installing'
    | 'error';
  downloaded: number;
  total: number | null;
  error: string | null;
  canQuitWithoutUpdating: boolean;
}
export interface AiSettings {
  baseUrl: string;
  model: string;
  prompt: string;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  density: 'compact' | 'comfortable';
  diffMode: 'split' | 'unified';
  updateCheckInterval: '1h' | '5h' | '1d' | '7d' | 'off';
  installUpdateOnQuit: boolean;
  searchIgnoredFiles: boolean;
  pullOnCheckout: boolean;
  autoFetchInterval: '30s' | '1m' | '5m' | '10m' | '15m' | '30m' | 'off';
  smartCommit: 'ask' | 'always' | 'never';
  zoom: number;
  maxFileTabs: number;
  ai: AiSettings;
}
export interface SettingsResponse extends Settings {
  keyStored: boolean;
}
export interface GeneratedMessage {
  message: string;
  source: 'index' | 'workingTree';
  detail: 'patch' | 'compacted';
}
export interface Session {
  tabs: {
    path: string;
    message: string;
    layout?: TabLayout | null;
    shown?: boolean;
  }[];
  active: string;
}
