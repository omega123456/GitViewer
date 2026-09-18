import { TextArea } from '../shared/TextArea';
import { GitCommitHorizontal, Loader2, Sparkles } from 'lucide-react';
import type {
  GeneratedMessage,
  SettingsResponse,
  Status,
} from '../../lib/types';
import { useGenerate, useGenerateState } from '../../stores/generate';
import { useMessage, useTabs } from '../../stores/tabs';
import { Button } from '../shared/Button';
import { field } from '../shared/styles';
export function aiConfigured(settings: SettingsResponse) {
  return Boolean(
    settings.ai.enabled &&
    settings.ai.baseUrl &&
    settings.ai.model &&
    settings.keyStored,
  );
}
export function sourceNotice(result: GeneratedMessage) {
  const parts = [
    ...(result.source === 'workingTree'
      ? ['summarized the unstaged working tree']
      : []),
    ...(result.detail === 'summary' ? ['used the file summary'] : []),
  ];
  return parts.length ? `Generation ${parts.join(' and ')}.` : null;
}
export function CommitFooter({
  repo,
  status,
  settings,
  disabled,
  commit,
}: {
  repo: string;
  status: Status;
  settings: SettingsResponse;
  disabled: boolean;
  commit: () => void;
}) {
  const message = useMessage(repo);
  const generate = useGenerateState(repo);
  const staged = status.entries.filter(
    (entry) => entry.index !== '.' && entry.index !== '?',
  ).length;
  const notice =
    generate.applied && generate.applied.message === message
      ? sourceNotice(generate.applied)
      : null;
  return (
    <section
      aria-label="Commit"
      className="flex shrink-0 flex-col gap-2 border-t border-line bg-sub p-2 dark:border-line-dark dark:bg-sub-dark"
    >
      {aiConfigured(settings) && (
        <div className="flex justify-end">
          <Button
            disabled={generate.busy}
            onClick={() => void useGenerate.getState().generate(repo)}
          >
            {generate.busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {generate.busy ? 'Generating' : 'Generate'}
          </Button>
        </div>
      )}
      <TextArea
        aria-label="Commit message"
        placeholder="Commit message"
        rows={2}
        value={message}
        className={`${field} resize-none`}
        onChange={(event) =>
          useTabs.getState().setMessage(repo, event.target.value)
        }
      />
      {generate.error && (
        <p
          role="alert"
          className="text-label text-remove-ink dark:text-remove-ink-dark"
        >
          {generate.error}
        </p>
      )}
      {notice && (
        <p className="text-label text-muted dark:text-muted-dark">{notice}</p>
      )}
      {generate.pending && (
        <div className="flex flex-col gap-2 rounded border border-line bg-surface p-2 dark:border-line-dark dark:bg-surface-dark">
          <p className="text-label text-muted dark:text-muted-dark">
            Replace your draft with the generated message?
          </p>
          <div className="flex justify-end gap-1.5">
            <Button onClick={() => useGenerate.getState().dismiss(repo)}>
              Keep draft
            </Button>
            <Button
              variant="primary"
              onClick={() => useGenerate.getState().confirm(repo)}
            >
              Replace
            </Button>
          </div>
        </div>
      )}
      {status.branch === '(detached)' && (
        <p className="text-label text-modified">
          This commit will be created on detached HEAD.
        </p>
      )}
      <Button disabled={disabled} variant="primary" onClick={commit}>
        <GitCommitHorizontal className="size-3.5" />
        <span className="truncate">
          Commit {staged} {staged === 1 ? 'file' : 'files'} to {status.branch}
        </span>
      </Button>
    </section>
  );
}
