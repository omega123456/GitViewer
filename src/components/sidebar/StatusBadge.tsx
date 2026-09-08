import { statusClass, statusLetter } from './nodes';
export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`ml-auto w-3.5 shrink-0 text-center font-mono text-label font-semibold ${statusClass(status)}`}
    >
      {statusLetter(status)}
    </span>
  );
}
