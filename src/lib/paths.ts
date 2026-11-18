export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function parentPath(path: string) {
  return path.replace(/[\\/]*[^\\/]+[\\/]*$/, '');
}
export function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}
