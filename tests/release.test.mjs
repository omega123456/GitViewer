import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configuration, collect, assemble } from '../scripts/release.mjs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tag = `v${version}`;
const keyBytes = Buffer.alloc(42);
keyBytes.write('Ed');
const publicKey = Buffer.from(
  `untrusted comment: test public key\n${keyBytes.toString('base64')}`,
).toString('base64');
test('release configuration requires matching stable versions and a signing key', () => {
  const config = configuration('.', 'example/GitViewer', publicKey, tag);
  assert.equal(
    config.plugins.updater.endpoints[0],
    'https://github.com/example/GitViewer/releases/latest/download/latest.json',
  );
  for (const [repo, key, candidateTag] of [
    ['', publicKey, tag],
    ['example/GitViewer', '', tag],
    ['example/GitViewer', publicKey, `${tag}-invalid`],
  ]) {
    assert.throws(() => configuration('.', repo, key, candidateTag));
  }
});
test('release assembly requires both signed platform archives and the installer', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gitviewer-release-'));
  try {
    const mac = path.join(root, 'mac');
    const windows = path.join(root, 'windows');
    const manifests = path.join(root, 'manifests');
    mkdirSync(mac);
    mkdirSync(windows);
    writeFileSync(path.join(mac, 'GitViewer.app.tar.gz'), 'archive');
    writeFileSync(path.join(mac, 'GitViewer.app.tar.gz.sig'), 'mac-signature');
    writeFileSync(path.join(mac, 'GitViewer.dmg'), 'installer');
    writeFileSync(path.join(windows, 'GitViewer-setup.exe'), 'installer');
    assert.throws(() =>
      collect(
        '.',
        windows,
        path.join(manifests, 'windows'),
        'windows-x86_64',
        'example/GitViewer',
        tag,
      ),
    );
    writeFileSync(
      path.join(windows, 'GitViewer-setup.exe.sig'),
      'windows-signature',
    );
    collect(
      '.',
      mac,
      path.join(manifests, 'mac'),
      'darwin-aarch64',
      'example/GitViewer',
      tag,
    );
    assert.throws(() =>
      assemble(manifests, path.join(root, 'missing'), 'example/GitViewer', tag),
    );
    collect(
      '.',
      windows,
      path.join(manifests, 'windows'),
      'windows-x86_64',
      'example/GitViewer',
      tag,
    );
    assert.throws(() =>
      assemble(manifests, path.join(root, 'wrong'), 'example/Other', tag),
    );
    assemble(manifests, path.join(root, 'output'), 'example/GitViewer', tag);
    const feed = JSON.parse(
      readFileSync(path.join(root, 'output/latest.json'), 'utf8'),
    );
    assert.deepEqual(Object.keys(feed.platforms), [
      'darwin-aarch64',
      'windows-x86_64',
    ]);
    assert.equal(feed.version, version);
    writeFileSync(
      path.join(manifests, 'windows/GitViewer-setup.exe.sig'),
      'changed-signature',
    );
    assert.throws(() =>
      assemble(manifests, path.join(root, 'invalid'), 'example/GitViewer', tag),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
