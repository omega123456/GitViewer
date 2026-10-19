export function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
export function parentPath(path: string) {
  return path.replace(/[\\/]*[^\\/]+[\\/]*$/, '');
}
