import type { FailedReply, Reply, Request, Token } from './highlight.worker';
import type { MarkRange } from './types';
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
function isFailure(reply: Reply): reply is FailedReply {
  return 'failed' in reply;
}
function deliver(reply: Reply) {
  const job = pending.get(reply.id);
  if (!job) return;
  if (isFailure(reply)) {
    pending.delete(reply.id);
    job.receive(0, plain(job.lines), true);
    return;
  }
  if (reply.done) pending.delete(reply.id);
  job.receive(reply.start, reply.lines, reply.done);
}
function connect() {
  if (worker) return worker;
  const created = new Worker(
    new URL('./highlight.worker.ts', import.meta.url),
    { type: 'module' },
  );
  created.addEventListener('message', (event: MessageEvent<Reply>) =>
    deliver(event.data),
  );
  created.addEventListener('error', terminate);
  created.addEventListener('messageerror', terminate);
  worker = created;
  return created;
}
export interface TokenizeJob {
  lines: string[];
  path: string;
  dark: boolean;
}
export function tokenize(job: TokenizeJob, receive: Receive) {
  const { lines, path, dark } = job;
  const id = ++next;
  pending.set(id, { lines, receive });
  const request: Request = {
    type: 'job',
    id: id,
    path: path,
    dark: dark,
    lines: lines,
  };
  connect().postMessage(request);
  return () => {
    const cancel: Request = { type: 'cancel', id: id };
    if (pending.delete(id)) worker?.postMessage(cancel);
  };
}
export function highlight(content: string, path: string, dark: boolean) {
  return new Promise<Token[][]>((resolve) => {
    const result: Token[][] = [];
    const job = { lines: content.split('\n'), path: path, dark: dark };
    tokenize(job, (start, lines, done) => {
      lines.forEach((line, index) => {
        result[start + index] = line;
      });
      if (done) resolve(result);
    });
  });
}

type MarkFlag = 'changed' | 'found' | 'current';
export type MarkedToken<T> = T & Partial<Record<MarkFlag, boolean>>;
function firstMarkEndingAfter(
  marks: MarkRange[],
  from: number,
  offset: number,
) {
  let mark = from;
  while (mark < marks.length && marks[mark][1] <= offset) mark++;
  return mark;
}
function segmentEnd(
  range: MarkRange | undefined,
  inside: boolean,
  end: number,
) {
  if (!range) return end;
  const boundary = inside ? range[1] : range[0];
  return Math.min(end, boundary);
}
export function markedTokens<T extends { content: string }>(
  tokens: T[],
  marks: MarkRange[],
  flag: MarkFlag = 'changed',
) {
  const result: MarkedToken<T>[] = [];
  let start = 0;
  let mark = 0;
  for (const token of tokens) {
    const end = start + token.content.length;
    let offset = start;
    while (offset < end) {
      mark = firstMarkEndingAfter(marks, mark, offset);
      const range = marks[mark];
      const inside = range !== undefined && range[0] <= offset;
      const stop = segmentEnd(range, inside, end);
      result.push({
        ...token,
        content: token.content.slice(offset - start, stop - start),
        [flag]: inside,
      });
      offset = stop;
    }
    start = end;
  }
  return result;
}
