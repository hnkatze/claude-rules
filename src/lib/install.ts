import type {
  InstallResult,
  Lockfile,
  Manifest,
  ProjectConfig,
  SettingsOwnership,
} from '../types.js';
import {
  installFile,
  mergeSettings,
  pruneEmptyClaudeDirs,
  readLockfile,
  readProjectConfig,
  removeInstalledFiles,
  removeMcps,
  removeSettings,
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

interface CategorizedFiles {
  all: string[];
  agents: string[];
  hookScripts: string[];
}

/** Downloads and writes a pack's files. Returns installed paths categorized by destination. */
export async function installPackFiles(manifest: Manifest): Promise<CategorizedFiles> {
  if (manifest.meta) return { all: [], agents: [], hookScripts: [] };
  const relPaths = await listPackFiles(manifest.name);
  const all: string[] = [];
  const agents: string[] = [];
  const hookScripts: string[] = [];
  for (const relPath of relPaths) {
    const content = await fetchPackFile(manifest.name, relPath);
    const dest = await installFile(relPath, content);
    if (dest === null) continue;
    all.push(dest);
    if (relPath.startsWith('agents/')) agents.push(dest);
    else if (relPath.startsWith('hooks/')) hookScripts.push(dest);
  }
  return { all, agents, hookScripts };
}

/**
 * Installs a pack's settings (env, permissions, plugins, marketplaces) and hook settings entries
 * into `.claude/settings.json`. Returns the ownership record to be stored in the lockfile.
 */
export async function installPackSettings(
  manifest: Manifest,
  warn: (msg: string) => void = () => {},
): Promise<SettingsOwnership> {
  if (manifest.meta) return {};
  return mergeSettings(manifest.name, manifest.settings, manifest.hooks?.settings, warn);
}

/**
 * Persists install state.
 *
 * - `results`: newly installed packs (this run). Written to the lockfile.
 * - `requestedPackNames`: packs the user explicitly asked for. Added/updated in `claude-rules.json`.
 *   Transitive deps are NOT added to config — they live only in the lockfile, so removing the
 *   top-level pack lets us detect them as orphans later.
 */
export async function recordInstalls(
  results: InstallResult[],
  requestedPackNames: string[],
): Promise<void> {
  const config = await readProjectConfig();
  const lock = await readLockfile();

  for (const { manifest, files, mcps, agents, hookScripts, settingsKeys } of results) {
    lock.packs[manifest.name] = {
      version: manifest.version,
      files,
      mcps,
      dependencies: manifest.dependencies,
      ...(agents.length > 0 ? { agents } : {}),
      ...(hookScripts.length > 0 ? { hookScripts } : {}),
      ...(hasOwnership(settingsKeys) ? { settingsKeys } : {}),
    };
  }

  for (const name of requestedPackNames) {
    const fromResult = results.find(r => r.manifest.name === name);
    const version = fromResult?.manifest.version ?? lock.packs[name]?.version;
    if (version) {
      config.packs[name] = `^${version}`;
    }
  }

  await writeProjectConfig(config);
  await writeLockfile(lock);

  const allRuleFiles = Object.values(lock.packs).flatMap(p => p.files);
  await updateClaudeMdBlock(allRuleFiles);
}

function hasOwnership(o: SettingsOwnership): boolean {
  return (
    (o.envKeys?.length ?? 0) > 0 ||
    (o.permissionsAllow?.length ?? 0) > 0 ||
    (o.marketplaceKeys?.length ?? 0) > 0 ||
    (o.pluginKeys?.length ?? 0) > 0 ||
    (o.hookCommands?.length ?? 0) > 0
  );
}

/**
 * Returns the names of packs that are in the lockfile but no longer reachable
 * from any top-level (config-listed) pack. These are leftovers from removing
 * a meta/parent pack.
 */
export function findOrphans(config: ProjectConfig, lock: Lockfile): string[] {
  const topLevel = Object.keys(config.packs);
  const reachable = new Set<string>();

  function walk(name: string): void {
    if (reachable.has(name)) return;
    if (!lock.packs[name]) return;
    reachable.add(name);
    for (const dep of lock.packs[name].dependencies) {
      walk(dep);
    }
  }

  for (const name of topLevel) walk(name);

  return Object.keys(lock.packs)
    .filter(name => !reachable.has(name))
    .sort();
}

/**
 * Removes one or more packs in a single batch: deletes files, strips MCPs,
 * reverses settings merge, updates config + lockfile, then rebuilds the CLAUDE.md block once.
 */
export async function uninstallPacks(
  packNames: string[],
): Promise<{ removed: string[]; missing: string[] }> {
  if (packNames.length === 0) return { removed: [], missing: [] };

  const config = await readProjectConfig();
  const lock = await readLockfile();
  const removed: string[] = [];
  const missing: string[] = [];

  for (const name of packNames) {
    const entry = lock.packs[name];
    if (!entry) {
      missing.push(name);
      continue;
    }
    await removeInstalledFiles(entry.files);
    await removeMcps(entry.mcps);
    await removeSettings(entry.settingsKeys);
    delete config.packs[name];
    delete lock.packs[name];
    removed.push(name);
  }

  await writeProjectConfig(config);
  await writeLockfile(lock);

  const allRuleFiles = Object.values(lock.packs).flatMap(p => p.files);
  await updateClaudeMdBlock(allRuleFiles);
  await pruneEmptyClaudeDirs();

  return { removed, missing };
}

/** Convenience wrapper for single-pack removal. */
export async function uninstallPack(packName: string): Promise<void> {
  const { removed, missing } = await uninstallPacks([packName]);
  if (missing.length > 0) {
    throw new Error(`Pack '${packName}' is not installed`);
  }
  if (removed.length === 0) {
    throw new Error(`Failed to remove '${packName}'`);
  }
}
