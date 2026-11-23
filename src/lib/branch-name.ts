import { HEAD } from './git';
import type { Branch } from './types';
const invalidRef =
  /[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-./]|\/\.|[./]$|\.lock(\/|$)|^@$/;
export function nameProblem(name: string, branches: Branch[]) {
  if (branches.some((branch) => branch.name === name))
    return `A branch named “${name}” already exists.`;
  if (invalidRef.test(name))
    return 'Not a valid branch name. Avoid ~ ^ : ? * [ \\ @{ and .., a leading - . or /, and a trailing . / or .lock.';
  return null;
}
const WHITESPACE_RUN = /\s+/g;
const WORD_JOINER = '-';
export function sanitizeBranchName(value: string) {
  return value.replace(WHITESPACE_RUN, WORD_JOINER);
}
export interface BranchRefs {
  head?: string;
  local: string[];
  remote: string[];
}
export function branchRefs(branches: Branch[]): BranchRefs {
  return {
    head: branches.find((branch) => branch.current)?.name,
    local: branches
      .filter((branch) => !branch.remote)
      .map((branch) => branch.name),
    remote: branches
      .filter((branch) => branch.remote)
      .map((branch) => branch.name),
  };
}
export function baseOrHead(base: string, head: string | undefined) {
  return base || head || HEAD;
}
export function baseGroups(refs: BranchRefs) {
  const local = refs.head ? refs.local : [HEAD, ...refs.local];
  return [
    { label: 'Local', options: local },
    { label: 'Remote', options: refs.remote },
  ].filter((group) => group.options.length);
}
export function baseBadges(head: string | undefined) {
  if (head) return { [head]: 'current' };
  return { [HEAD]: 'detached' };
}
