import type { ReactNode } from 'react';
export const card =
  'rounded-card border border-card-stroke bg-card dark:border-card-stroke-dark dark:bg-card-dark';
export function SettingGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="mb-0.5 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
export function SettingCard({
  icon,
  title,
  description,
  below,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  below?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-2.5 ${card}`}
    >
      <span className="flex size-4 shrink-0">{icon}</span>
      <span className="grid min-w-45 flex-1 text-sm">
        {title}
        <small className="text-label text-muted dark:text-muted-dark">
          {description}
        </small>
      </span>
      {children && (
        <span className="flex shrink-0 items-center gap-2">{children}</span>
      )}
      {below && (
        <div className="flex basis-full flex-col gap-2 pl-8">{below}</div>
      )}
    </div>
  );
}
