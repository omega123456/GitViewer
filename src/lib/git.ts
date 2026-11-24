import type { Status } from './types';
export const UNTRACKED = '?';
export const UNMODIFIED = '.';
export const DETACHED_LABEL = '(detached)';
export const HEAD = 'HEAD';
export const SHORT_HASH_LENGTH = 7;
const SCOPE_SEPARATOR = ':';
export function shortHash(hash: string) {
  return hash.slice(0, SHORT_HASH_LENGTH);
}
export function isDetached(branch: string | undefined) {
  return branch === DETACHED_LABEL;
}
export interface Head {
  detached: boolean;
  oid: string;
  branch: string;
}
export function statusHead(status: Status): Head {
  return {
    detached: isDetached(status.branch),
    oid: status.oid,
    branch: status.branch,
  };
}
export function headName(head: Head) {
  return head.detached ? shortHash(head.oid) : head.branch;
}
export function headLabel(head: Head) {
  return head.detached ? `${headName(head)} detached` : head.branch;
}
export function scopeKey(repo: string, name: string) {
  return `${repo}${SCOPE_SEPARATOR}${name}`;
}
export function isScopeOf(scope: string, repo: string) {
  return scope.startsWith(scopeKey(repo, ''));
}
export function scopeName(scope: string) {
  return scope.slice(scope.lastIndexOf(SCOPE_SEPARATOR) + 1);
}
