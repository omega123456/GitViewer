import { useMemo, useRef } from 'react';
import { ArrowLeftRight, CheckCircle2, ChevronDown } from 'lucide-react';
import { useActions } from '../../lib/actions';
import { useBackend } from '../../lib/query';
import type { Comparison, Status } from '../../lib/types';
import { useLayout, useTabLayout, type TabLayout } from '../../stores/layout';
import { useCurrentSelection, useSelection } from '../../stores/selection';
import { Button } from '../shared/Button';
import { ViewAllButton } from '../shared/ViewAllButton';
import { CheckBox } from '../shared/CheckBox';
import { TextInput } from '../shared/TextInput';
import { field } from '../shared/styles';
import { ErrorState } from '../states/Errors';
import { State } from '../states/State';
import { revisionTree } from './reveal';
import { RevisionTree } from './RevisionTree';
import { isDetached, shortHash, scopeKey } from '../../lib/git';
import { useOpenFile } from '../../lib/open-file';
export function openCompare(repo: string, patch: Partial<TabLayout> = {}) {
  useLayout.getState().update(repo, { ...patch, mode: 'compare' });
  useSelection.getState().viewAll(repo, 'compare');
}
export function swapCompare(repo: string, base: string, target: string) {
  useLayout
    .getState()
    .update(repo, { compareBase: target, compareTarget: base });
}
export function baseFieldId(repo: string) {
  return scopeKey(repo, 'compare-base');
}
export function useComparison(repo: string, status: Status, enabled: boolean) {
  const layout = useTabLayout(repo);
  const fallback = useBackend('default_branch', { repo }, enabled);
  const base = layout.compareBase || fallback.data || '';
  const target =
    layout.compareTarget ||
    (isDetached(status.branch) ? shortHash(status.oid) : status.branch);
  const same = base === target;
  const files = useBackend(
    'compare_files',
    { repo: repo, base: base, target: target, mergeBase: layout.mergeBase },
    enabled && Boolean(base) && Boolean(target) && !same,
  );
  const branches = useBackend('branches', { repo }, enabled);
  const known = (name: string) =>
    branches.data?.some((branch) => branch.name === name) ?? true;
  const unknownRef = Boolean(files.error) && (!known(base) || !known(target));
  const last = useRef<Comparison | undefined>(undefined);
  if (files.data) last.current = files.data;
  const data = same
    ? undefined
    : (files.data ?? (unknownRef ? last.current : undefined));
  return {
    base: base,
    target: target,
    same: same,
    mergeBase: layout.mergeBase,
    files: files,
    data: data,
    error: files.error && !unknownRef ? files.error : null,
    known: known,
    branches: branches,
  };
}
export function CompareError({
  repo,
  message,
  mergeBase,
}: {
  repo: string;
  message: string;
  mergeBase: boolean;
}) {
  return (
    <ErrorState
      title="Could not compare branches"
      error={{ message }}
      action={
        mergeBase && (
          <Button
            variant="standard"
            onClick={() =>
              useLayout.getState().update(repo, { mergeBase: false })
            }
          >
            Use the direct diff instead
          </Button>
        )
      }
    />
  );
}
export function SameRefState() {
  return (
    <State icon={CheckCircle2} title="Nothing to compare">
      Both branches point at the same commit.
    </State>
  );
}
interface PickerField {
  label: string;
  value: string;
  key: 'compareBase' | 'compareTarget';
  id?: string;
}
export function CompareSection({
  repo,
  status,
}: {
  repo: string;
  status: Status;
}) {
  const { base, target, same, mergeBase, files, data, error, known, branches } =
    useComparison(repo, status, true);
  const selection = useCurrentSelection(repo, 'compare');
  const openFile = useOpenFile(repo);
  const update = (patch: Partial<TabLayout>) =>
    useLayout.getState().update(repo, patch);
  const references = scopeKey(repo, 'compare-references');
  const statuses = useMemo(
    () =>
      Object.fromEntries(
        (data?.files ?? []).map((file) => [file.path, file.status]),
      ),
    [data],
  );
  useActions(scopeKey(repo, 'compare'), [
    {
      id: 'swap-compare',
      icon: <ArrowLeftRight className="size-3.5" />,
      label: 'Swap compared branches',
      key: 'Mod+Alt+r',
      run: () => swapCompare(repo, base, target),
    },
  ]);
  const picker = ({ label, value, key, id }: PickerField) => (
    <label className="flex cursor-pointer flex-col gap-0.5">
      <span className="text-label font-semibold text-muted dark:text-muted-dark">
        {label}
      </span>
      <span className="relative">
        <TextInput
          id={id}
          list={references}
          aria-invalid={Boolean(files.error) && !known(value)}
          className={`${field} h-7 pr-6 font-mono text-diff`}
          value={value}
          onChange={(event) => update({ [key]: event.target.value })}
        />
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-2.5 -translate-y-1/2 text-faint dark:text-faint-dark" />
      </span>
    </label>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-2.5 py-3 text-sm dark:border-line-dark">
        {picker({
          label: 'Base',
          value: base,
          key: 'compareBase',
          id: baseFieldId(repo),
        })}
        <div className="flex justify-center">
          <Button
            variant="standard"
            className="h-control text-label"
            aria-label="Swap base and compare branches"
            title="Swap base and compare branches"
            onClick={() => swapCompare(repo, base, target)}
          >
            <ArrowLeftRight className="size-3" />
            Swap
          </Button>
        </div>
        {picker({ label: 'Compare', value: target, key: 'compareTarget' })}
        <datalist id={references}>
          {branches.data?.map((branch) => (
            <option key={branch.name} value={branch.name} />
          ))}
        </datalist>
        <div className="flex items-center gap-2 pt-0.5">
          <CheckBox
            label="Since branches diverged"
            checked={mergeBase}
            onChange={() => update({ mergeBase: !mergeBase })}
          />
          Since branches diverged
        </div>
        <p className="pl-7 text-label leading-snug text-faint dark:text-faint-dark">
          Off: compare the two tips directly, including work that landed on{' '}
          <b className="font-semibold">{base}</b> later.
        </p>
      </div>
      <h3 className="flex h-section shrink-0 items-center gap-2 border-b border-line px-2.5 text-label text-muted dark:border-line-dark">
        Changed files
        <span className="ml-auto rounded-full bg-chrome px-1.5 font-mono dark:bg-chrome-dark">
          {data?.files.length ?? 0}
        </span>
        <ViewAllButton
          repo={repo}
          stack="compare"
          label="All changes between branches"
          look="section"
        />
      </h3>
      {same ? (
        <SameRefState />
      ) : error ? (
        <CompareError
          repo={repo}
          message={error.message}
          mergeBase={mergeBase}
        />
      ) : data ? (
        <RevisionTree
          key={`${data.base}:${data.target}`}
          repo={repo}
          tree={revisionTree({
            source: 'compare',
            base: data.base,
            revision: data.target,
          })}
          label="Changed files"
          paths={data.files.map((file) => file.path)}
          statuses={statuses}
          selectedPath={selection?.path}
          onSelect={(path) =>
            openFile({
              path: path,
              source: 'compare',
              base: data.base,
              revision: data.target,
            })
          }
        />
      ) : null}
    </div>
  );
}
