export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function parentPath(path: string) {
  return path.replace(/[\\/]*[^\\/]+[\\/]*$/, '');
}
const WINDOWS_VERBATIM_PREFIX = /^\\\\\?\\/;
const WINDOWS_SEPARATOR = '\\';
const POSIX_SEPARATOR = '/';
export interface SplitPath {
  directory: string;
  name: string;
}
export function splitPath(path: string): SplitPath {
  const nameStart = path.lastIndexOf(POSIX_SEPARATOR) + 1;
  return { directory: path.slice(0, nameStart), name: path.slice(nameStart) };
}
export function fileName(path: string) {
  return splitPath(path).name;
}
export function absolutePath(repo: string, path: string) {
  const root = repo.replace(WINDOWS_VERBATIM_PREFIX, '');
  const windowsPath = path.replaceAll(POSIX_SEPARATOR, WINDOWS_SEPARATOR);
  const windowsRoot = root.includes(WINDOWS_SEPARATOR);
  return windowsRoot
    ? `${root}${WINDOWS_SEPARATOR}${windowsPath}`
    : `${root}${POSIX_SEPARATOR}${path}`;
}
