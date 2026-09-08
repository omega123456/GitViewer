import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { compareDesc } from 'date-fns';

const cargo = (args) =>
  spawnSync('rustup', ['run', 'stable', 'cargo', ...args], {
    stdio: 'inherit',
  });

const pruneForeignCoverageBinaries = () => {
  const depsDir = path.join(
    'src-tauri',
    'target',
    'llvm-cov-target',
    'debug',
    'deps',
  );
  if (!existsSync(depsDir)) {
    return;
  }

  const binaries = readdirSync(depsDir)
    .filter((name) => !name.includes('.') || name.endsWith('.exe'))
    .map((name) => path.join(depsDir, name))
    .filter((candidate) => statSync(candidate).isFile());
  const newestTestBinary = binaries
    .filter((candidate) => path.basename(candidate).startsWith('integration-'))
    .sort((left, right) =>
      compareDesc(statSync(left).mtime, statSync(right).mtime),
    )[0];

  for (const candidate of binaries) {
    if (candidate !== newestTestBinary) {
      rmSync(candidate, { force: true });
    }
  }
};

const cleanResult = cargo([
  'llvm-cov',
  'clean',
  '--profraw-only',
  '--manifest-path',
  'src-tauri/Cargo.toml',
]);
if (cleanResult.status !== 0) {
  process.exit(cleanResult.status ?? 1);
}

pruneForeignCoverageBinaries();

const result = cargo([
  'llvm-cov',
  'nextest',
  '--no-clean',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '--features',
  'test-utils',
  '--no-default-features',
  '--fail-under-lines',
  '90',
  '--fail-under-functions',
  '90',
  '--fail-under-regions',
  '80',
]);

process.exit(result.status ?? 1);
