import { TextArea } from '../shared/TextArea';
import { GitCommitHorizontal, Sparkles } from 'lucide-react';
import type {
  GeneratedMessage,
  SettingsResponse,
  Status,
} from '../../lib/types';
import { shortcutLabel } from '../../lib/keyboard';
import { saveSettings } from '../../lib/settings';
import { useCommit, useCommitState } from '../../stores/commit';
import {
  appliedMessage,
  generationError,
  isGenerating,
  useGenerate,
  useGeneration,
} from '../../stores/generate';
import { runCommit } from '../../lib/commit';
import {
  useLayout,
  useTabLayout,
  commitMessageHeightBounds,
} from '../../stores/layout';
import {
  type CommitMode,
  useCommitMode,
  useMessage,
  useTabs,
} from '../../stores/tabs';
import { Button } from '../shared/Button';
import { BusyIcon } from '../shared/BusyIcon';
import { dynamic, field, mutedLabel } from '../shared/styles';
import { SplitButton, SplitMenu, SplitPrimary } from '../shared/SplitButton';
import { ResizeHandle } from '../shell/ResizeHandle';
import { FieldError } from '../states/Errors';
import { isDetached, UNTRACKED, UNMODIFIED } from '../../lib/git';
import { keysOf } from '../../lib/options';
import { boundsOf } from '../../lib/geometry';
import { plural } from '../../lib/text';
export function aiConfigured(settings: SettingsResponse) {
  return Boolean(settings.ai.baseUrl && settings.ai.model);
}
export function sourceNotice(result: GeneratedMessage) {
  const parts = [
    ...(result.source === 'workingTree'
      ? ['summarized the unstaged working tree']
      : []),
    ...(result.detail === 'compacted' ? ['compacted the large diff'] : []),
  ];
  return parts.length ? `Generation ${parts.join(' and ')}.` : null;
}
const modes: Record<CommitMode, { label: string; key: string }> = {
  commit: { label: 'Commit', key: 'Mod+Enter' },
  commitPush: { label: 'Commit & Push', key: 'Mod+Shift+Enter' },
};
const modeOptions = keysOf(modes);
function isStaged(entry: Status['entries'][number]) {
  return entry.index !== UNMODIFIED && entry.index !== UNTRACKED;
}
export function commitLabel(
  status: Status,
  mode: CommitMode,
  smartCommit: boolean,
) {
  const verb = mode === 'commitPush' ? 'Commit & push' : 'Commit';
  const staged = status.entries.filter(isStaged).length;
  const changed = status.entries.length;
  const offersAll = staged === 0 && smartCommit && changed > 0;
  if (offersAll)
    return `${verb} all ${plural(changed, 'change')} to ${status.branch}`;
  return `${verb} ${plural(staged, 'file')} to ${status.branch}`;
}
interface FooterProps {
  repo: string;
  status: Status;
  settings: SettingsResponse;
  disabled: boolean;
  pushable: boolean;
  commit: (mode: CommitMode) => void;
}
type CommitFlow = ReturnType<typeof useCommitState>;
function buttonLabel(flow: CommitFlow, props: FooterProps, active: CommitMode) {
  const { status, settings } = props;
  if (flow.phase === 'committing') return 'Committing…';
  if (flow.phase === 'pushing')
    return `Pushing to ${status.upstream ?? status.branch}`;
  return commitLabel(status, active, settings.smartCommit !== 'never');
}
function GenerateBar({
  repo,
  settings,
}: {
  repo: string;
  settings: SettingsResponse;
}) {
  const generating = isGenerating(useGeneration(repo));
  if (!aiConfigured(settings)) return null;
  return (
    <div className="flex justify-end">
      <Button
        disabled={generating}
        onClick={() => void useGenerate.getState().generate(repo)}
      >
        <BusyIcon busy={generating} icon={Sparkles} className="size-3.5" />
        {generating ? 'Generating' : 'Generate'}
      </Button>
    </div>
  );
}
function MessageField({ repo, message }: { repo: string; message: string }) {
  const { commitMessageHeight } = useTabLayout(repo);
  return (
    <div className="relative">
      <ResizeHandle
        label="Resize commit message"
        orientation="vertical"
        bounds={commitMessageHeightBounds}
        value={commitMessageHeight}
        className="absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize rounded-t focus-visible:bg-accent"
        measure={(event) =>
          boundsOf(event.currentTarget.nextElementSibling).bottom -
          event.clientY
        }
        onChange={(next) =>
          useLayout.getState().update(repo, { commitMessageHeight: next })
        }
      />
      <TextArea
        aria-label="Commit message"
        placeholder="Commit message"
        value={message}
        className={`${field} h-message resize-none py-1.5 text-sm`}
        style={dynamic({ '--message-height': `${commitMessageHeight}px` })}
        onChange={(event) =>
          useTabs.getState().setMessage(repo, event.target.value)
        }
      />
    </div>
  );
}
function GenerationNotes({ repo, message }: { repo: string; message: string }) {
  const generation = useGeneration(repo);
  const failure = generationError(generation);
  const applied = appliedMessage(generation);
  const current = applied && applied.message === message;
  const notice = current ? sourceNotice(applied) : null;
  return (
    <>
      {failure && <FieldError>{failure}</FieldError>}
      {notice && <p className={mutedLabel}>{notice}</p>}
    </>
  );
}
function StagePrompt({
  props,
  message,
  flow,
}: {
  props: FooterProps;
  message: string;
  flow: CommitFlow;
}) {
  const { repo, settings, status } = props;
  const changes = status.entries.map((entry) => entry.path);
  const stageAll = (always: boolean) => {
    const pending = flow.prompt ?? 'commit';
    if (always) void saveSettings(settings, { smartCommit: 'always' });
    void runCommit(repo, { message: message, mode: pending, stage: changes });
  };
  if (!flow.prompt) return null;
  return (
    <div
      role="group"
      aria-label="Stage all and commit"
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2 dark:border-line-dark dark:bg-surface-dark"
    >
      <p className={mutedLabel}>
        Nothing is staged. Stage all {plural(changes.length, 'change')} and
        commit?
      </p>
      <div className="flex justify-end gap-1.5">
        <Button onClick={() => useCommit.getState().dismiss(repo)}>
          Not now
        </Button>
        <Button onClick={() => stageAll(true)}>Always</Button>
        <Button variant="primary" onClick={() => stageAll(false)}>
          Stage all &amp; commit
        </Button>
      </div>
    </div>
  );
}
function CommitButton({
  props,
  flow,
}: {
  props: FooterProps;
  flow: CommitFlow;
}) {
  const { repo, disabled, pushable } = props;
  const mode = useCommitMode(repo);
  const active = pushable ? mode : 'commit';
  return (
    <SplitButton>
      <SplitPrimary
        size="compact"
        disabled={disabled}
        onClick={() => props.commit(active)}
      >
        <BusyIcon busy={flow.phase !== 'idle'} icon={GitCommitHorizontal} />
        <span className="truncate">{buttonLabel(flow, props, active)}</span>
      </SplitPrimary>
      <SplitMenu
        size="compact"
        label="Commit options"
        disabled={disabled || !pushable}
        side="top"
        width="w-60"
        value={active}
        options={modeOptions}
        onChange={(option) => useTabs.getState().setCommitMode(repo, option)}
        renderOption={(option) => (
          <>
            <span className="flex-1">{modes[option].label}</span>
            <span className={mutedLabel}>
              {shortcutLabel(modes[option].key)}
            </span>
          </>
        )}
      />
    </SplitButton>
  );
}
export function CommitFooter(props: FooterProps) {
  const { repo, status, settings } = props;
  const message = useMessage(repo);
  const flow = useCommitState(repo);
  return (
    <section
      aria-label="Commit"
      className="flex shrink-0 flex-col border-t border-line bg-sub dark:border-line-dark dark:bg-sub-dark"
    >
      <div className="flex flex-col gap-2 p-2">
        <GenerateBar repo={repo} settings={settings} />
        <MessageField repo={repo} message={message} />
        <GenerationNotes repo={repo} message={message} />
        <StagePrompt props={props} message={message} flow={flow} />
        {isDetached(status.branch) && (
          <p className="text-label text-modified dark:text-modified-dark">
            This commit will be created on detached HEAD.
          </p>
        )}
        <CommitButton props={props} flow={flow} />
      </div>
    </section>
  );
}
