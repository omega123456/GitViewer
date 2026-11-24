import { act, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { highlight, terminate, tokenize } from '../lib/highlight';
import { highlightWorker, type Reply } from '../lib/highlight.worker';
import { imageUrl } from '../components/image/url';
import { workers } from './setup';

const CHUNK_SIZE = 500;
const LONG_FILE_LINES = 1200;
const LAST_CHUNK_LINES = 200;
const SECOND_CHUNK_START = 1000;
const COMMENT_START_LINE = 498;
const COMMENT_MID_LINE = 499;
const COMMENT_END_LINE = 501;
const AFTER_COMMENT_LINE = 502;
const OVERLONG_CHARS = 2500;
const QUEUED_LARGE_LINES = 1500;
const QUEUED_SMALL_LINES = 10;
const JOB_TWO = 2;
const JOB_THREE = 3;
const JOB_FOUR = 4;
const JOB_FIVE = 5;
const TWO_QUEUED = 2;
const IMAGE_VERSION = 17;

function generatedCode(lineCount: number) {
  return Array.from(
    { length: lineCount },
    (_unused, index) => `const row${index} = ${index};`,
  );
}

function startWorker(react: (reply: Reply) => void = () => {}) {
  const replies: Reply[] = [];
  const worker = highlightWorker((reply) => {
    replies.push(reply);
    react(reply);
  });
  const finished = (id: number) =>
    replies.some(
      (reply) => reply.id === id && ('failed' in reply || reply.done),
    );
  return { replies: replies, worker: worker, finished: finished };
}

function chunksOf(replies: Reply[], id: number) {
  return replies.flatMap((reply) =>
    reply.id === id && !('failed' in reply) ? [reply] : [],
  );
}

it('delivers 500-line chunks and carries the grammar state across them', async () => {
  const { replies, worker, finished } = startWorker();
  const lines = generatedCode(LONG_FILE_LINES);
  lines[COMMENT_START_LINE] = '/*';
  lines[COMMENT_MID_LINE] = 'still a comment';
  lines[CHUNK_SIZE] = 'still a comment';
  lines[COMMENT_END_LINE] = '*/';
  worker.receive({
    type: 'job',
    id: 1,
    path: 'a.ts',
    dark: false,
    lines: lines,
  });
  await waitFor(() => expect(finished(1)).toBe(true));
  const chunks = chunksOf(replies, 1);
  expect(
    chunks.map(({ start, lines: chunkLines, done }) => [
      start,
      chunkLines.length,
      done,
    ]),
  ).toEqual([
    [0, CHUNK_SIZE, false],
    [CHUNK_SIZE, CHUNK_SIZE, false],
    [SECOND_CHUNK_START, LAST_CHUNK_LINES, true],
  ]);
  const tokens = chunks.flatMap((chunk) => chunk.lines);
  const comment = tokens[COMMENT_START_LINE][0].color;
  expect(comment).toBeDefined();
  expect(tokens[COMMENT_MID_LINE][0].color).toBe(comment);
  expect(tokens[CHUNK_SIZE][0].color).toBe(comment);
  expect(
    tokens[AFTER_COMMENT_LINE].some((token) => token.color !== comment),
  ).toBe(true);
  expect(worker.languages()).toContain('typescript');
});

it('leaves an overlong line as one uncoloured token and plain text for unknown languages', async () => {
  const { replies, worker, finished } = startWorker();
  const long = `const text = "${'a'.repeat(OVERLONG_CHARS)}";`;
  worker.receive({
    type: 'job',
    id: 1,
    path: 'notes.unknown',
    dark: true,
    lines: ['plain', ''],
  });
  await waitFor(() => expect(finished(1)).toBe(true));
  expect(chunksOf(replies, 1)[0].lines).toEqual([
    [{ content: 'plain' }],
    [{ content: '' }],
  ]);
  expect(worker.languages()).toEqual([]);
  worker.receive({
    type: 'job',
    id: JOB_TWO,
    path: 'a.ts',
    dark: false,
    lines: ['const shown = 1;', long, 'const after = 2;'],
  });
  await waitFor(() => expect(finished(JOB_TWO)).toBe(true));
  const [first, capped, after] = chunksOf(replies, JOB_TWO)[0].lines;
  expect(capped).toEqual([{ content: long }]);
  expect(first.some((token) => token.color)).toBe(true);
  expect(after.some((token) => token.color)).toBe(true);
});

it('interleaves queued jobs, stops cancelled ones at a chunk boundary, and reports failures', async () => {
  const { replies, worker, finished } = startWorker((reply) => {
    if (reply.id === JOB_THREE)
      worker.receive({ type: 'cancel', id: JOB_THREE });
  });
  const sendJob = (id: number, lines: string[]) =>
    worker.receive({
      type: 'job',
      id: id,
      path: 'a.ts',
      dark: false,
      lines: lines,
    });
  const failingLines = new Proxy<string[]>([], {
    get() {
      throw new Error('unreadable lines');
    },
  });
  sendJob(1, generatedCode(QUEUED_LARGE_LINES));
  sendJob(JOB_TWO, generatedCode(QUEUED_SMALL_LINES));
  sendJob(JOB_THREE, generatedCode(QUEUED_LARGE_LINES));
  sendJob(JOB_FOUR, generatedCode(QUEUED_SMALL_LINES));
  worker.receive({ type: 'cancel', id: JOB_FOUR });
  sendJob(JOB_FIVE, failingLines);
  await waitFor(() => expect(finished(1) && finished(JOB_FIVE)).toBe(true));
  const small = replies.findIndex((reply) => reply.id === JOB_TWO);
  const large = replies.findIndex(
    (reply) => reply.id === 1 && !('failed' in reply) && reply.done,
  );
  expect(small).toBeGreaterThanOrEqual(0);
  expect(small).toBeLessThan(large);
  expect(chunksOf(replies, JOB_THREE)).toHaveLength(1);
  expect(replies.some((reply) => reply.id === JOB_FOUR)).toBe(false);
  expect(replies).toContainEqual({ id: JOB_FIVE, failed: true });
});

it('serves one-shot requests and survives fake timers', async () => {
  vi.useFakeTimers();
  const lines = await highlight(
    generatedCode(LONG_FILE_LINES).join('\n'),
    'a.ts',
    true,
  );
  expect(lines).toHaveLength(LONG_FILE_LINES);
  expect(lines[LONG_FILE_LINES - 1].some((token) => token.color)).toBe(true);
  vi.useRealTimers();
  workers.failing = true;
  expect(await highlight('const a = 1;\nb', 'a.ts', false)).toEqual([
    [{ content: 'const a = 1;' }],
    [{ content: 'b' }],
  ]);
});

it('fails every pending job to plain tokens when the worker breaks, then starts afresh', async () => {
  for (const type of ['error', 'messageerror'] as const) {
    workers.held = true;
    const streamed: [number, number, boolean][] = [];
    tokenize(
      { lines: ['a', 'b'], path: 'a.ts', dark: false },
      (start, lines, done) => streamed.push([start, lines.length, done]),
    );
    const oneShot = highlight('x', 'a.ts', false);
    const broken = workers.live;
    if (!broken) throw new Error('Expected live highlight worker');
    await waitFor(() => expect(workers.queued.length).toBe(TWO_QUEUED));
    act(() => broken.fail(type));
    expect(streamed).toEqual([[0, TWO_QUEUED, true]]);
    expect(await oneShot).toEqual([[{ content: 'x' }]]);
    workers.held = false;
    workers.queued = [];
    const before = workers.created;
    expect(await highlight('y', 'a.ts', false)).toHaveLength(1);
    expect(workers.created).toBe(before + 1);
    expect(workers.live).not.toBe(broken);
  }
  workers.held = true;
  const pending = highlight('z', 'a.ts', false);
  terminate();
  expect(await pending).toEqual([[{ content: 'z' }]]);
  expect(workers.live).toBeUndefined();
});

it('highlights syntax and safely encodes image references', async () => {
  expect(
    (await highlight('const value = "hello";', 'app.ts', false))[0].length,
  ).toBeGreaterThan(1);
  expect((await highlight('plain', 'unknown.xyz', true))[0][0].content).toBe(
    'plain',
  );
  expect(
    imageUrl({
      repo: 'a & b',
      selection: { path: 'a#b.png', source: 'staged' },
      side: 'old',
    }),
  ).toContain('path=a%23b.png');
  expect(
    imageUrl({
      repo: 'repo',
      selection: { path: 'a.png', source: 'unstaged' },
      side: 'new',
      version: IMAGE_VERSION,
    }),
  ).toContain('version=17');
});
