import { statusClass, statusLetter } from './nodes';
export function StatusBadge({
  status,
  partial = false,
}: {
  status: string;
  partial?: boolean;
}) {
  if (partial)
    return (
      <span
        className="ml-auto flex w-3.5 shrink-0 items-center justify-center"
        title="Partly staged"
      >
        <span className="flex size-status-dot overflow-hidden rounded-full">
          <span className="flex-1 bg-added dark:bg-added-dark" />
          <span className="flex-1 bg-muted dark:bg-muted-dark" />
        </span>
      </span>
    );
  return (
    <span
      className={`ml-auto w-3.5 shrink-0 text-center font-mono text-label font-semibold ${statusClass(status)}`}
    >
      {statusLetter(status)}
    </span>
  );
}
