import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const srcTauri = path.join(repoRoot, 'platform/everywear-os/src-tauri');
const resourcesRoot = path.join(srcTauri, 'resources');
const sidecarSource = path.join(srcTauri, 'sidecar/video-encoder');
const sidecarResource = path.join(resourcesRoot, 'sidecar/video-encoder');
const pinnedNodeVersion = process.env.EVERYWEAR_NODE_VERSION || '22.16.0';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const actualCommand = isWindows && command.endsWith('.cmd') ? 'cmd.exe' : command;
  const actualArgs = isWindows && command.endsWith('.cmd')
    ? ['/d', '/s', '/c', command, ...args]
    : args;
  const result = spawnSync(actualCommand, actualArgs, {
    cwd: options.cwd || repoRoot,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    const cause = result.error ? `: ${result.error.message}` : '';
    const signal = result.signal ? ` signal ${result.signal}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}${signal}${cause}`);
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true });
}

async function download(url, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        download(response.headers.location, target).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
        return;
      }
      const file = createWriteStream(target);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

function readNodeVersion(nodeExe) {
  const result = spawnSync(nodeExe, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim().replace(/^v/, '');
}

async function ensurePinnedNode() {
  if (!isWindows) {
    throw new Error('Pinned Node bundling is currently implemented for Windows Tauri packages only.');
  }

  const target = path.join(resourcesRoot, 'node.exe');
  if (await pathExists(target)) {
    const version = readNodeVersion(target);
    if (version === pinnedNodeVersion) {
      console.log(`[bundle] node.exe already staged at v${version}`);
      return;
    }
    await fs.rm(target, { force: true });
  }

  const explicit = process.env.EVERYWEAR_NODE_EXE;
  if (explicit) {
    const version = readNodeVersion(explicit);
    if (version !== pinnedNodeVersion) {
      throw new Error(`EVERYWEAR_NODE_EXE points to v${version}; expected v${pinnedNodeVersion}.`);
    }
    await fs.copyFile(explicit, target);
    await fs.writeFile(path.join(resourcesRoot, 'node-version.txt'), `node v${version}\n`);
    console.log(`[bundle] copied pinned node.exe v${version} from EVERYWEAR_NODE_EXE`);
    return;
  }

  const archiveName = `node-v${pinnedNodeVersion}-win-x64.zip`;
  const url = `https://nodejs.org/dist/v${pinnedNodeVersion}/${archiveName}`;
  const cacheDir = path.join(os.tmpdir(), 'everywear-tauri-resources');
  const zipPath = path.join(cacheDir, archiveName);
  const extractRoot = path.join(cacheDir, `node-v${pinnedNodeVersion}-win-x64`);

  if (!(await pathExists(zipPath))) {
    console.log(`[bundle] downloading pinned Node v${pinnedNodeVersion}`);
    await download(url, zipPath);
  }

  await fs.rm(extractRoot, { recursive: true, force: true });
  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${extractRoot.replaceAll("'", "''")}' -Force`,
  ]);

  const extractedNode = path.join(extractRoot, `node-v${pinnedNodeVersion}-win-x64`, 'node.exe');
  if (!(await pathExists(extractedNode))) {
    throw new Error(`Pinned Node archive did not contain ${extractedNode}`);
  }
  await fs.copyFile(extractedNode, target);
  await fs.writeFile(path.join(resourcesRoot, 'node-version.txt'), `node v${pinnedNodeVersion}\n`);
  console.log(`[bundle] staged pinned node.exe v${pinnedNodeVersion}`);
}

async function stageVideoEncoder() {
  if (!(await pathExists(path.join(sidecarSource, 'node_modules')))) {
    run(npm, ['ci'], { cwd: sidecarSource });
  }
  run(npm, ['run', 'build'], { cwd: sidecarSource });

  await fs.rm(sidecarResource, { recursive: true, force: true });
  await fs.mkdir(sidecarResource, { recursive: true });
  await copyDir(path.join(sidecarSource, 'dist'), path.join(sidecarResource, 'dist'));
  await fs.copyFile(path.join(sidecarSource, 'package.json'), path.join(sidecarResource, 'package.json'));
  await fs.copyFile(path.join(sidecarSource, 'package-lock.json'), path.join(sidecarResource, 'package-lock.json'));
  run(npm, ['ci', '--omit=dev', '--ignore-scripts'], { cwd: sidecarResource });
  console.log('[bundle] staged video encoder dist and production dependencies');
}

async function stageOptionalFfmpeg() {
  const explicit = process.env.EVERYWEAR_FFMPEG_EXE || process.env.FFMPEG_PATH;
  if (!explicit) {
    console.warn('[bundle] FFmpeg not bundled. Release will look in app resources or ~/.everywear/bin/ffmpeg/ffmpeg.exe.');
    return;
  }
  if (!(await pathExists(explicit))) {
    throw new Error(`FFmpeg path does not exist: ${explicit}`);
  }
  const targetDir = path.join(resourcesRoot, 'ffmpeg/bin');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(explicit, path.join(targetDir, 'ffmpeg.exe'));
  console.log('[bundle] staged ffmpeg.exe from explicit environment path');
}

async function main() {
  await fs.mkdir(resourcesRoot, { recursive: true });
  await Promise.all([
    stageVideoEncoder(),
    ensurePinnedNode(),
    stageOptionalFfmpeg(),
  ]);
}

main().catch((error) => {
  console.error(`[bundle] ${error.message}`);
  console.error('[bundle] Repair: set EVERYWEAR_NODE_EXE to a pinned node.exe, or allow download from nodejs.org.');
  process.exit(1);
});
