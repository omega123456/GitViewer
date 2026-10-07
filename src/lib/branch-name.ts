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
