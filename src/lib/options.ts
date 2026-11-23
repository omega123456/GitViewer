export function keysOf<T extends object>(record: T) {
  return Object.keys(record).filter(
    (key): key is Extract<keyof T, string> => key in record,
  );
}
export function chooseOption<T extends string>(
  options: readonly T[],
  value: string,
  choose: (option: T) => void,
) {
  const option = options.find((candidate) => candidate === value);
  if (option === undefined) return;
  choose(option);
}
