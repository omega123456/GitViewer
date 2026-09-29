import type { Reply, Request, Token } from './highlight.worker';
export type { Token };
export type Receive = (start: number, lines: Token[][], done: boolean) => void;
let worker: Worker | undefined;
let next = 0;
const pending = new Map<number, { lines: string[]; receive: Receive }>();
function plain(lines: string[]) {
  return lines.map((content) => [{ content }]);
}
export function terminate() {
  worker?.terminate();
  worker = undefined;
  const failed = [...pending.values()];
  pending.clear();
  failed.forEach((job) => job.receive(0, plain(job.lines), true));
}
function connect() {
  if (worker) return worker;
  const created = new Worker(
    new URL('./highlight.worker.ts', import.meta.url),
    { type: 'module' },
  );
  created.addEventListener('message', (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const job = pending.get(reply.id);
    if (!job) return;
    if ('failed' in reply || reply.done) pending.delete(reply.id);
    if ('failed' in reply) job.receive(0, plain(job.lines), true);
    else job.receive(reply.start, reply.lines, reply.done);
  });
  created.addEventListener('error', terminate);
  created.addEventListener('messageerror', terminate);
  worker = created;
  return created;
}
export function tokenize(
  lines: string[],
  path: string,
  dark: boolean,
  receive: Receive,
) {
  const id = ++next;
  pending.set(id, { lines, receive });
  const job: Request = { type: 'job', id, path, dark, lines };
  connect().postMessage(job);
  return () => {
    const cancel: Request = { type: 'cancel', id };
    if (pending.delete(id)) worker?.postMessage(cancel);
  };
}
export function highlight(content: string, path: string, dark: boolean) {
  return new Promise<Token[][]>((resolve) => {
    const result: Token[][] = [];
    tokenize(content.split('\n'), path, dark, (start, lines, done) => {
      lines.forEach((line, index) => {
        result[start + index] = line;
      });
      if (done) resolve(result);
    });
  });
}

export function markedTokens<
  T extends { content: string },
  K extends string = 'changed',
>(tokens: T[], marks: [number, number][], flag = 'changed' as K) {
  const result: (T & Record<K, boolean>)[] = [];
  let start = 0;
  let mark = 0;
  for (const token of tokens) {
    const end = start + token.content.length;
    let offset = start;
    while (offset < end) {
      while (mark < marks.length && marks[mark][1] <= offset) mark++;
      const range = marks[mark];
      const inside = range !== undefined && range[0] <= offset;
      const stop = Math.min(end, range ? range[inside ? 1 : 0] : end);
      result.push({
        ...token,
        content: token.content.slice(offset - start, stop - start),
        [flag]: inside,
      } as T & Record<K, boolean>);
      offset = stop;
    }
    start = end;
  }
  return result;
}
