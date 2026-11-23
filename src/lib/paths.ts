export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function parentPath(path: string) {
  return path.replace(/[\\/]*[^\\/]+[\\/]*$/, '');
}
export function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}
const WINDOWS_VERBATIM_PREFIX = /^\\\\\?\\/;
const WINDOWS_SEPARATOR = '\\';
const POSIX_SEPARATOR = '/';
export function absolutePath(repo: string, path: string) {
  const root = repo.replace(WINDOWS_VERBATIM_PREFIX, '');
  const windowsPath = path.replaceAll(POSIX_SEPARATOR, WINDOWS_SEPARATOR);
  const windowsRoot = root.includes(WINDOWS_SEPARATOR);
  return windowsRoot
    ? `${root}${WINDOWS_SEPARATOR}${windowsPath}`
    : `${root}${POSIX_SEPARATOR}${path}`;
}
