import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const root = new URL('../', import.meta.url);
const files = {
  package: new URL('package.json', root),
  tauri: new URL('src-tauri/tauri.conf.json', root),
  cargo: new URL('src-tauri/Cargo.toml', root),
};
const git = (...args) =>
  execFileSync('git', args, { cwd: root, stdio: 'inherit' });

const current = JSON.parse(readFileSync(files.package, 'utf8')).version;
const [major, minor, patch] = current.split('.').map(Number);
const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[process.argv[2]] ?? process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? '') || next === current) {
  console.error(`Usage: pnpm release:version <major|minor|patch|X.Y.Z> (current ${current})`);
  process.exit(1);
}

const replaceVersion = (file, pattern) =>
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(pattern, `$1${next}$2`),
  );
replaceVersion(files.package, /^(\s*"version": ")[^"]+(")/m);
replaceVersion(files.tauri, /^(\s*"version": ")[^"]+(")/m);
replaceVersion(files.cargo, /^(version = ")[^"]+(")/m);
execFileSync('cargo', ['update', '--workspace', '--offline'], {
  cwd: new URL('src-tauri/', root),
  stdio: 'inherit',
});

git('add', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock');
git('commit', '-m', `Bump version to ${next}`);
git('tag', `v${next}`);
git('push');
git('push', 'origin', `v${next}`);
