import { RotateCcw, Search, WrapText } from 'lucide-react';
import { isolateHistory } from '@codemirror/commands';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Opened } from '../../lib/types';
import {
  approveDiscard,
  drop,
  keepEdits,
  reload,
  save,
  type Buffer,
  type FileKey,
} from '../../stores/editor';
import { useStopEditing } from '../../lib/open-file';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';
import { accentToggle } from '../shared/styles';
import { openFind } from './setup';
const outline =
  'border border-line bg-surface text-ink dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark';
async function revertEditorBuffer(
  view: EditorView | undefined,
  file: FileKey,
  saved: Text,
) {
  if (!view || !(await approveDiscard(file))) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: saved },
    annotations: isolateHistory.of('full'),
  });
}
function EditorMeta({
  buffer,
  language,
}: {
  buffer: Buffer;
  language: string;
}) {
  const head = buffer.state.selection.main.head;
  const line = buffer.state.doc.lineAt(head);
  return (
    <span className="flex gap-2.5 text-meta text-muted dark:text-muted-dark">
      <span>{language}</span>
      <span>{buffer.disk.bom ? 'UTF-8 with BOM' : 'UTF-8'}</span>
      <span>{buffer.disk.crlf ? 'CRLF' : 'LF'}</span>
      <span className="tabular-nums">
        Ln {line.number}, Col {head - line.from + 1}
      </span>
    </span>
  );
}
function SaveControl({ file, buffer }: { file: FileKey; buffer: Buffer }) {
  if (buffer.saving)
    return (
      <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted dark:text-muted-dark">
        <Spinner className="size-3" />
        Saving…
      </span>
    );
  return (
    <Button
      variant="primary"
      disabled={!buffer.dirty}
      onClick={() => void save(file)}
    >
      Save
    </Button>
  );
}
export function EditorToolbar({
  file,
  buffer,
  language,
  view,
  wrap,
  toggleWrap,
}: {
  file: FileKey;
  buffer: Buffer;
  language: string;
  view: EditorView | undefined;
  wrap: boolean;
  toggleWrap: () => void;
}) {
  const revertDisabled = !view || !buffer.dirty || buffer.saving;
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-sub px-2 dark:border-line-dark dark:bg-sub-dark">
      <EditorMeta buffer={buffer} language={language} />
      <span className="ml-auto flex items-center gap-1.5">
        <Button
          title="Word wrap"
          aria-pressed={wrap}
          variant="icon"
          className={`size-control ${wrap ? accentToggle : 'text-muted dark:text-muted-dark'}`}
          onClick={toggleWrap}
        >
          <WrapText className="size-3.5" />
        </Button>
        <Button
          className="text-muted dark:text-muted-dark"
          disabled={!view}
          onClick={() => view && openFind(view, false)}
        >
          <Search className="size-4" />
          <span>Find</span>
        </Button>
        <Button
          className="text-muted dark:text-muted-dark"
          disabled={revertDisabled}
          onClick={() => void revertEditorBuffer(view, file, buffer.disk.saved)}
        >
          <RotateCcw className="size-4" />
          <span>Revert</span>
        </Button>
        <SaveControl file={file} buffer={buffer} />
      </span>
    </div>
  );
}
export function ConflictBanner({
  file,
  name,
  current,
}: {
  file: FileKey;
  name: string;
  current: Opened | null;
}) {
  const stopEditing = useStopEditing(file.repo);
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2.5 border-b border-line bg-merge px-3 py-1.5 text-sm text-merge-ink dark:border-line-dark dark:bg-merge-dark dark:text-merge-ink-dark"
    >
      {current ? (
        <span>
          <b>{name} changed on disk</b> since you started editing. Your edits
          are still here.
        </span>
      ) : (
        <span>
          <b>{name} was deleted on disk.</b> Your edits are still here.
        </span>
      )}
      <span className="ml-auto flex gap-1.5">
        {current ? (
          <Button className={outline} onClick={() => reload(file, current)}>
            Reload from disk
          </Button>
        ) : (
          <Button
            className={outline}
            onClick={() => {
              drop(file);
              stopEditing();
            }}
          >
            Discard edits
          </Button>
        )}
        <Button variant="primary" onClick={() => keepEdits(file)}>
          Keep my edits
        </Button>
      </span>
    </div>
  );
}
