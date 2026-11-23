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
function headName(status: Status) {
  return isDetached(status.branch) ? shortHash(status.oid) : status.branch;
}
interface Endpoints {
  base: string;
  target: string;
}
function comparable({ base, target }: Endpoints) {
  const named = Boolean(base) && Boolean(target);
  return named && base !== target;
}
function useLastComparison(fresh?: Comparison) {
  const last = useRef<Comparison | undefined>(undefined);
  if (fresh) last.current = fresh;
  return last.current;
}
function useEndpoints(repo: string, status: Status, enabled: boolean) {
  const layout = useTabLayout(repo);
  const fallback = useBackend('default_branch', { repo }, enabled);
  return {
    base: layout.compareBase || fallback.data || '',
    target: layout.compareTarget || headName(status),
    mergeBase: layout.mergeBase,
  };
}
export function useComparison(repo: string, status: Status, enabled: boolean) {
  const { base, target, mergeBase } = useEndpoints(repo, status, enabled);
  const same = base === target;
  const files = useBackend(
    'compare_files',
    { repo: repo, base: base, target: target, mergeBase: mergeBase },
    enabled && comparable({ base, target }),
  );
  const branches = useBackend('branches', { repo }, enabled);
  const known = (name: string) =>
    branches.data?.some((branch) => branch.name === name) ?? true;
  const bothKnown = known(base) && known(target);
  const unknownRef = Boolean(files.error) && !bothKnown;
  const last = useLastComparison(files.data);
  const fallback = unknownRef ? last : undefined;
  return {
    base: base,
    target: target,
    same: same,
    mergeBase: mergeBase,
    files: files,
    data: same ? undefined : (files.data ?? fallback),
    error: unknownRef ? null : (files.error ?? null),
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
type ComparisonState = ReturnType<typeof useComparison>;
interface CompareView {
  repo: string;
  comparison: ComparisonState;
  references: string;
}
function updateLayout(repo: string, patch: Partial<TabLayout>) {
  useLayout.getState().update(repo, patch);
}
function RefPicker({
  view,
  field: picked,
}: {
  view: CompareView;
  field: PickerField;
}) {
  const { files, known } = view.comparison;
  return (
    <label className="flex cursor-pointer flex-col gap-0.5">
      <span className="text-label font-semibold text-muted dark:text-muted-dark">
        {picked.label}
      </span>
      <span className="relative">
        <TextInput
          id={picked.id}
          list={view.references}
          aria-invalid={Boolean(files.error) && !known(picked.value)}
          className={`${field} h-7 pr-6 font-mono text-diff`}
          value={picked.value}
          onChange={(event) =>
            updateLayout(view.repo, { [picked.key]: event.target.value })
          }
        />
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-2.5 -translate-y-1/2 text-faint dark:text-faint-dark" />
      </span>
    </label>
  );
}
function SwapButton({ view }: { view: CompareView }) {
  const { base, target } = view.comparison;
  return (
    <div className="flex justify-center">
      <Button
        variant="standard"
        className="h-control text-label"
        aria-label="Swap base and compare branches"
        title="Swap base and compare branches"
        onClick={() => swapCompare(view.repo, base, target)}
      >
        <ArrowLeftRight className="size-3" />
        Swap
      </Button>
    </div>
  );
}
function MergeBaseToggle({ view }: { view: CompareView }) {
  const { base, mergeBase } = view.comparison;
  return (
    <>
      <div className="flex items-center gap-2 pt-0.5">
        <CheckBox
          label="Since branches diverged"
          checked={mergeBase}
          onChange={() => updateLayout(view.repo, { mergeBase: !mergeBase })}
        />
        Since branches diverged
      </div>
      <p className="pl-7 text-label leading-snug text-faint dark:text-faint-dark">
        Off: compare the two tips directly, including work that landed on{' '}
        <b className="font-semibold">{base}</b> later.
      </p>
    </>
  );
}
function ComparePickers({ view }: { view: CompareView }) {
  const { base, target, branches } = view.comparison;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line px-2.5 py-3 text-sm dark:border-line-dark">
      <RefPicker
        view={view}
        field={{
          label: 'Base',
          value: base,
          key: 'compareBase',
          id: baseFieldId(view.repo),
        }}
      />
      <SwapButton view={view} />
      <RefPicker
        view={view}
        field={{ label: 'Compare', value: target, key: 'compareTarget' }}
      />
      <datalist id={view.references}>
        {branches.data?.map((branch) => (
          <option key={branch.name} value={branch.name} />
        ))}
      </datalist>
      <MergeBaseToggle view={view} />
    </div>
  );
}
function ChangedFilesHeader({ view }: { view: CompareView }) {
  return (
    <h3 className="flex h-section shrink-0 items-center gap-2 border-b border-line px-2.5 text-label text-muted dark:border-line-dark">
      Changed files
      <span className="ml-auto rounded-full bg-chrome px-1.5 font-mono dark:bg-chrome-dark">
        {view.comparison.data?.files.length ?? 0}
      </span>
      <ViewAllButton
        repo={view.repo}
        stack="compare"
        label="All changes between branches"
        look="section"
      />
    </h3>
  );
}
function ComparedFiles({ repo, data }: { repo: string; data: Comparison }) {
  const selection = useCurrentSelection(repo, 'compare');
  const openFile = useOpenFile(repo);
  const statuses = useMemo(
    () =>
      Object.fromEntries(data.files.map((file) => [file.path, file.status])),
    [data],
  );
  return (
    <RevisionTree
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
  );
}
function CompareResult({ view }: { view: CompareView }) {
  const { same, error, data, mergeBase } = view.comparison;
  if (same) return <SameRefState />;
  if (error)
    return (
      <CompareError
        repo={view.repo}
        message={error.message}
        mergeBase={mergeBase}
      />
    );
  if (!data) return null;
  return (
    <ComparedFiles
      key={`${data.base}:${data.target}`}
      repo={view.repo}
      data={data}
    />
  );
}
export function CompareSection({
  repo,
  status,
}: {
  repo: string;
  status: Status;
}) {
  const comparison = useComparison(repo, status, true);
  const view = {
    repo: repo,
    comparison: comparison,
    references: scopeKey(repo, 'compare-references'),
  };
  useActions(scopeKey(repo, 'compare'), [
    {
      id: 'swap-compare',
      icon: <ArrowLeftRight className="size-3.5" />,
      label: 'Swap compared branches',
      key: 'Mod+Alt+r',
      run: () => swapCompare(repo, comparison.base, comparison.target),
    },
  ]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ComparePickers view={view} />
      <ChangedFilesHeader view={view} />
      <CompareResult view={view} />
    </div>
  );
}
