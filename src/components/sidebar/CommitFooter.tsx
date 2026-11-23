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
export function commitLabel(
  status: Status,
  mode: CommitMode,
  smartCommit: boolean,
) {
  const verb = mode === 'commitPush' ? 'Commit & push' : 'Commit';
  const staged = status.entries.filter(
    (entry) => entry.index !== UNMODIFIED && entry.index !== UNTRACKED,
  ).length;
  if (staged === 0 && smartCommit && status.entries.length > 0)
    return `${verb} all ${plural(status.entries.length, 'change')} to ${status.branch}`;
  return `${verb} ${plural(staged, 'file')} to ${status.branch}`;
}
export function CommitFooter({
  repo,
  status,
  settings,
  disabled,
  pushable,
  commit,
}: {
  repo: string;
  status: Status;
  settings: SettingsResponse;
  disabled: boolean;
  pushable: boolean;
  commit: (mode: CommitMode) => void;
}) {
  const message = useMessage(repo);
  const mode = useCommitMode(repo);
  const generation = useGeneration(repo);
  const generating = isGenerating(generation);
  const generationFailure = generationError(generation);
  const applied = appliedMessage(generation);
  const flow = useCommitState(repo);
  const notice =
    applied && applied.message === message ? sourceNotice(applied) : null;
  const changes = status.entries.map((entry) => entry.path);
  const active = pushable ? mode : 'commit';
  const label =
    flow.phase === 'committing'
      ? 'Committing…'
      : flow.phase === 'pushing'
        ? `Pushing to ${status.upstream ?? status.branch}`
        : commitLabel(status, active, settings.smartCommit !== 'never');
  const stageAll = (always: boolean) => {
    const pending = flow.prompt ?? 'commit';
    if (always) void saveSettings(settings, { smartCommit: 'always' });
    void runCommit(repo, {
      message: message,
      mode: pending,
      stage: changes,
    });
  };
  const { commitMessageHeight } = useTabLayout(repo);
  return (
    <section
      aria-label="Commit"
      className="flex shrink-0 flex-col border-t border-line bg-sub dark:border-line-dark dark:bg-sub-dark"
    >
      <div className="flex flex-col gap-2 p-2">
        {aiConfigured(settings) && (
          <div className="flex justify-end">
            <Button
              disabled={generating}
              onClick={() => void useGenerate.getState().generate(repo)}
            >
              <BusyIcon
                busy={generating}
                icon={Sparkles}
                className="size-3.5"
              />
              {generating ? 'Generating' : 'Generate'}
            </Button>
          </div>
        )}
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
        {generationFailure && <FieldError>{generationFailure}</FieldError>}
        {notice && <p className={mutedLabel}>{notice}</p>}
        {flow.prompt && (
          <div
            role="group"
            aria-label="Stage all and commit"
            className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2 dark:border-line-dark dark:bg-surface-dark"
          >
            <p className={mutedLabel}>
              Nothing is staged. Stage all {plural(changes.length, 'change')}{' '}
              and commit?
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
        )}
        {isDetached(status.branch) && (
          <p className="text-label text-modified dark:text-modified-dark">
            This commit will be created on detached HEAD.
          </p>
        )}
        <SplitButton>
          <SplitPrimary
            size="compact"
            disabled={disabled}
            onClick={() => commit(active)}
          >
            <BusyIcon busy={flow.phase !== 'idle'} icon={GitCommitHorizontal} />
            <span className="truncate">{label}</span>
          </SplitPrimary>
          <SplitMenu
            size="compact"
            label="Commit options"
            disabled={disabled || !pushable}
            side="top"
            width="w-60"
            value={active}
            options={modeOptions}
            onChange={(option) =>
              useTabs.getState().setCommitMode(repo, option)
            }
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
      </div>
    </section>
  );
}
