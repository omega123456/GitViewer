import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { pathToFileURL, URL } from 'node:url';
import { formatISO } from 'date-fns';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) =>
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
function requireValue(value, message) {
  if (!value) throw new Error(message);
  return value;
}
export function configuration(root, repository, publicKey, tag) {
  requireValue(
    /^[\w.-]+\/[\w.-]+$/.test(repository ?? ''),
    'A GitHub owner/repository is required',
  );
  const version = readJson(path.join(root, 'package.json')).version;
  const tauri = readJson(path.join(root, 'src-tauri/tauri.conf.json'));
  const cargo = readFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    'utf8',
  ).match(/^version = "([^"]+)"/m)?.[1];
  requireValue(
    /^\d+\.\d+\.\d+$/.test(version) &&
      tag === `v${version}` &&
      cargo === version &&
      tauri.version === version,
    'Tag and all application versions must match a stable version',
  );
  const keyLines = Buffer.from(publicKey ?? '', 'base64')
    .toString('utf8')
    .trim()
    .split('\n');
  const keyBytes = Buffer.from(keyLines[1] ?? '', 'base64');
  requireValue(
    keyLines.length === 2 &&
      keyLines[0].startsWith('untrusted comment:') &&
      keyBytes.length === 42 &&
      keyBytes.subarray(0, 2).toString() === 'Ed',
    'A real Tauri updater public key is required',
  );
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        endpoints: [
          `https://github.com/${repository}/releases/latest/download/latest.json`,
        ],
        pubkey: publicKey,
        windows: { installMode: 'passive' },
      },
    },
  };
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
export function collect(root, directory, output, platform, repository, tag) {
  requireValue(
    ['darwin-aarch64', 'windows-x86_64'].includes(platform),
    'Unsupported update platform',
  );
  const candidates = files(directory);
  const extension = platform === 'darwin-aarch64' ? '.app.tar.gz' : '.exe';
  const archives = candidates.filter((file) => file.endsWith(extension));
  requireValue(archives.length === 1, 'Expected exactly one updater archive');
  const archive = archives[0];
  const signature = readFileSync(`${archive}.sig`, 'utf8').trim();
  requireValue(signature.length > 0, 'Updater signature is empty');
  const assets = candidates.filter(
    (file) =>
      file.endsWith(extension) ||
      file.endsWith(`${extension}.sig`) ||
      file.endsWith('.dmg'),
  );
  if (platform === 'darwin-aarch64')
    requireValue(
      assets.some((file) => file.endsWith('.dmg')),
      'Missing macOS disk image',
    );
  mkdirSync(output, { recursive: true });
  for (const asset of assets)
    copyFileSync(asset, path.join(output, path.basename(asset)));
  writeJson(path.join(output, `${platform}.json`), {
    version: readJson(path.join(root, 'package.json')).version,
    platforms: {
      [platform]: {
        signature,
        url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(path.basename(archive))}`,
      },
    },
  });
}
export function assemble(directory, output, repository, tag) {
  const inputs = files(directory);
  const platforms = {};
  for (const platform of ['darwin-aarch64', 'windows-x86_64']) {
    const manifests = inputs.filter(
      (file) => path.basename(file) === `${platform}.json`,
    );
    requireValue(
      manifests.length === 1,
      `Missing or duplicate ${platform} manifest`,
    );
    const manifest = readJson(manifests[0]);
    requireValue(
      `v${manifest.version}` === tag,
      'Release manifest version mismatch',
    );
    const entry = manifest.platforms[platform];
    requireValue(
      entry?.signature &&
        entry.url.startsWith(
          `https://github.com/${repository}/releases/download/${tag}/`,
        ),
      'Invalid release URL or signature',
    );
    const name = decodeURIComponent(
      new URL(entry.url).pathname.split('/').at(-1),
    );
    requireValue(
      name.endsWith(platform === 'darwin-aarch64' ? '.app.tar.gz' : '.exe'),
      'Incorrect platform archive',
    );
    const asset = inputs.find((file) => path.basename(file) === name);
    requireValue(
      asset &&
        existsSync(`${asset}.sig`) &&
        readFileSync(`${asset}.sig`, 'utf8').trim() === entry.signature,
      'Missing archive or mismatched signature',
    );
    platforms[platform] = entry;
  }
  requireValue(
    inputs.some((file) => file.endsWith('.dmg')),
    'Missing macOS installer',
  );
  mkdirSync(output, { recursive: true });
  const copied = new Set();
  for (const file of inputs.filter((file) => !file.endsWith('.json'))) {
    const name = path.basename(file);
    requireValue(!copied.has(name), 'Duplicate release asset name');
    copyFileSync(file, path.join(output, name));
    copied.add(name);
  }
  writeJson(path.join(output, 'latest.json'), {
    version: tag.slice(1),
    notes: `GitViewer ${tag}`,
    pub_date: formatISO(new Date()),
    platforms,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [command, ...args] = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY;
  const tag = process.env.GITHUB_REF_NAME;
  if (command === 'configure')
    writeJson(
      'release.config.json',
      configuration('.', repository, process.env.TAURI_UPDATER_PUBLIC_KEY, tag),
    );
  else if (command === 'collect')
    collect('.', args[0], args[1], args[2], repository, tag);
  else if (command === 'assemble') assemble(args[0], args[1], repository, tag);
  else if (command === 'notes') {
    const feed = readJson(args[0]);
    feed.notes = readJson(args[1]).body;
    writeJson(args[0], feed);
  } else throw new Error('Expected configure, collect, assemble, or notes');
}
