import { platform, version } from '@tauri-apps/plugin-os';
const FIRST_WINDOWS_11_BUILD = 22000;
const BUILD_PART = 2;
const VERSION_SEPARATOR = '.';
function osBuild() {
  return Number(version().split(VERSION_SEPARATOR)[BUILD_PART]);
}
export function mica() {
  return platform() === 'windows' && osBuild() >= FIRST_WINDOWS_11_BUILD;
}
