import type { InstallResult, Manifest } from '../types.js';
import {
  installFile,
  mergeMcps,
  readLockfile,
  readProjectConfig,
  removeInstalledFiles,
  removeMcps,
  updateClaudeMdBlock,
  writeLockfile,
  writeProjectConfig,
} from './local.js';
import { fetchManifest, fetchPackFile, listPackFiles } from './registry.js';

/** Resolves dependencies depth-first; returns manifests in install order (deps first). */
export async function resolveInstallOrder(packNames: string[]): Promise<Manifest[]> {
  const visited = new Map<string, Manifest>();
  const order: Manifest[] = [];

  async function visit(name: string, stack: string[]): Promise<void> {
    if (visited.has(name)) return;
    if (stack.includes(name)) {
      throw new Error(`Circular dependency detected: ${[...stack, name].join(' → ')}`);
    }
    const manifest = await fetchManifest(name);
    visited.set(name, manifest);
    for (const dep of manifest.dependencies) {
      await visit(dep, [...stack, name]);
    }
    order.push(manifest);
  }

  for (const name of packNames) {
    await visit(name, []);
  }
  return order;
}

/** Downloads and writes a pack's files. Returns installed paths (relative to project root). */
export async function installPackFiles(manifest: Manifest): Promise<string[]> {
  if (manifest.meta) return [];
  const relPaths = await listPackFiles(manifest.name);
  const installed: string[] = [];
  for (const relPath of relPaths) {
    const content = await fetchPackFile(manifest.name, relPath);
    const dest = await installFile(relPath, content);
    if (dest !== null) installed.push(dest);
  }
  return installed;
}

/** Persists installed packs to project config + lockfile + CLAUDE.md block. */
export async function recordInstalls(results: InstallResult[]): Promise<void> {
  const config = await readProjectConfig();
  const lock = await readLockfile();

  for (const { manifest, files, mcps } of results) {
    config.packs[manifest.name] = `^${manifest.version}`;
    lock.packs[manifest.name] = {
      version: manifest.version,
      files,
      mcps,
      dependencies: manifest.dependencies,
    };
  }

  await writeProjectConfig(config);
  await writeLockfile(lock);

  const allRuleFiles = Object.values(lock.packs).flatMap(p => p.files);
  await updateClaudeMdBlock(allRuleFiles);
}

export async function uninstallPack(packName: string): Promise<void> {
  const config = await readProjectConfig();
  const lock = await readLockfile();
  const entry = lock.packs[packName];
  if (!entry) throw new Error(`Pack '${packName}' is not installed`);

  await removeInstalledFiles(entry.files);
  await removeMcps(entry.mcps);

  delete config.packs[packName];
  delete lock.packs[packName];

  await writeProjectConfig(config);
  await writeLockfile(lock);

  const allRuleFiles = Object.values(lock.packs).flatMap(p => p.files);
  await updateClaudeMdBlock(allRuleFiles);
}
