import { format, fromUnixTime } from 'date-fns';
import { useBackend } from '../../lib/query';
import { ErrorRow } from '../states/Errors';
export function CommitDetails({
  repo,
  revision,
}: {
  repo: string;
  revision: string;
}) {
  const detail = useBackend('commit_detail', { repo, revision });
  if (detail.error)
    return (
      <ErrorRow
        label="Could not load the commit details"
        error={detail.error}
        retry={() => void detail.refetch()}
      />
    );
  if (!detail.data) return null;
  const { subject, author, timestamp, hash, body } = detail.data;
  const facts = [
    ['Author', author, ''],
    ['Date', format(fromUnixTime(timestamp), 'd MMM yyyy, HH:mm'), ''],
    ['Commit', hash, 'font-mono break-all'],
  ];
  return (
    <section
      aria-label="Commit details"
      className="flex max-h-2/5 shrink-0 flex-col gap-2 overflow-y-auto border-t border-line bg-surface px-4 pt-3 pb-3.5 dark:border-line-dark dark:bg-surface-dark"
    >
      <h3 className="text-sm font-semibold break-words">{subject}</h3>
      <dl className="flex flex-col gap-0.5 text-label">
        {facts.map(([term, value, style]) => (
          <div key={term} className="flex gap-3">
            <dt className="w-12 shrink-0 text-muted dark:text-muted-dark">
              {term}
            </dt>
            <dd className={`min-w-0 ${style}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {body && (
        <p className="text-sm break-words whitespace-pre-wrap">{body}</p>
      )}
    </section>
  );
}
