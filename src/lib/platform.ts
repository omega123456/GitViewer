import { platform, version } from '@tauri-apps/plugin-os';
export function mica() {
  return platform() === 'windows' && Number(version().split('.')[2]) >= 22000;
}
