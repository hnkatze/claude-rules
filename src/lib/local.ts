import {
  access,
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { platform } from 'node:os';
import type {
  HookSetting,
  Lockfile,
  McpEntry,
  ProjectConfig,
  SettingsBlock,
  SettingsOwnership,
} from '../types.js';

const PROJECT_CONFIG_FILE = 'claude-rules.json';
const LOCKFILE = 'claude-rules.lock.json';
const MCP_FILE = '.mcp.json';
const SETTINGS_FILE = '.claude/settings.json';
const CLAUDE_MD_FILE = 'CLAUDE.md';

const BLOCK_START = '<!-- @hnkatze/claude-rules:start -->';
const BLOCK_END = '<!-- @hnkatze/claude-rules:end -->';
const BLOCK_NOTICE = '<!-- managed block — do not edit manually; use `claude-rules` CLI -->';

export const ROOT = process.cwd();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readProjectConfig(): Promise<ProjectConfig> {
  const path = join(ROOT, PROJECT_CONFIG_FILE);
  if (!(await exists(path))) return { packs: {} };
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text) as ProjectConfig;
}

export async function writeProjectConfig(config: ProjectConfig): Promise<void> {
  const path = join(ROOT, PROJECT_CONFIG_FILE);
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
}

export async function readLockfile(): Promise<Lockfile> {
  const path = join(ROOT, LOCKFILE);
  if (!(await exists(path))) return { lockfileVersion: 1, packs: {} };
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text) as Lockfile;
}

export async function writeLockfile(lock: Lockfile): Promise<void> {
  const path = join(ROOT, LOCKFILE);
  await writeFile(path, JSON.stringify(lock, null, 2) + '\n');
}

/** Maps a pack-relative path to its install destination. Returns null for ignored paths. */
export function resolveInstallPath(relPath: string): string | null {
  const top = relPath.split('/')[0];
  if (top !== 'rules' && top !== 'skills' && top !== 'agents' && top !== 'hooks') return null;
  return join(ROOT, '.claude', relPath);
}

export async function installFile(relPath: string, content: string): Promise<string | null> {
  const dest = resolveInstallPath(relPath);
  if (!dest) return null;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, content);
  if (relPath.startsWith('hooks/') && platform() !== 'win32') {
    await chmod(dest, 0o755);
  }
  return relative(ROOT, dest).replaceAll('\\', '/');
}

export async function removeInstalledFiles(files: string[]): Promise<void> {
  for (const file of files) {
    const path = join(ROOT, file);
    if (await exists(path)) await rm(path, { force: true });
  }
}

/** Recursively removes empty directories under .claude/. Bottom-up walk. */
async function rmEmptyRecursive(dir: string): Promise<boolean> {
  if (!(await exists(dir))) return true;
  const entries = await readdir(dir, { withFileTypes: true });
  let allEmpty = true;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const childRemoved = await rmEmptyRecursive(join(dir, entry.name));
      if (!childRemoved) allEmpty = false;
    } else {
      allEmpty = false;
    }
  }
  if (allEmpty) {
    await rmdir(dir);
    return true;
  }
  return false;
}

/** Cleans up empty install dirs under .claude/. */
export async function pruneEmptyClaudeDirs(): Promise<void> {
  await rmEmptyRecursive(join(ROOT, '.claude'));
}

interface McpJson {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

async function readMcpJson(): Promise<McpJson> {
  const path = join(ROOT, MCP_FILE);
  if (!(await exists(path))) return {};
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text) as McpJson;
}

async function writeMcpJson(data: McpJson): Promise<void> {
  const path = join(ROOT, MCP_FILE);
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

export async function mergeMcps(entries: McpEntry[]): Promise<string[]> {
  if (entries.length === 0) return [];
  const data = await readMcpJson();
  const servers = data.mcpServers ?? {};
  for (const entry of entries) {
    servers[entry.name] = entry.config;
  }
  data.mcpServers = servers;
  await writeMcpJson(data);
  return entries.map(e => e.name);
}

export async function removeMcps(names: string[]): Promise<void> {
  if (names.length === 0) return;
  const data = await readMcpJson();
  if (!data.mcpServers) return;
  for (const name of names) {
    delete data.mcpServers[name];
  }
  await writeMcpJson(data);
}

interface SettingsJson {
  env?: Record<string, string>;
  permissions?: { allow?: string[]; deny?: string[] };
  extraKnownMarketplaces?: Record<string, unknown>;
  enabledPlugins?: Record<string, boolean>;
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
  [key: string]: unknown;
}

async function readSettingsJson(): Promise<SettingsJson> {
  const path = join(ROOT, SETTINGS_FILE);
  if (!(await exists(path))) return {};
  const text = await readFile(path, 'utf-8');
  return JSON.parse(text) as SettingsJson;
}

async function writeSettingsJson(data: SettingsJson): Promise<void> {
  const path = join(ROOT, SETTINGS_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Merges a pack's `settings` block + `hooks.settings[]` entries into `.claude/settings.json`.
 *
 * Ownership is tracked in the lockfile (returned `SettingsOwnership`), not by injecting
 * `_packOrigin` markers into settings.json — this keeps settings.json runtime-clean for
 * Claude Code while still enabling deterministic uninstall.
 *
 * Conflict policy (per docs/cli-contract-v2.md §5):
 * - env.<KEY>            last-write-wins, warn on collision
 * - permissions.allow[]  set union (dedupe by exact string)
 * - extraKnownMarketplaces  shallow merge by key, warn on collision
 * - enabledPlugins.<k>   last-write-wins
 * - hooks.<event>[]      append, dedupe by exact command string
 */
export async function mergeSettings(
  packName: string,
  settings: SettingsBlock | undefined,
  hookSettings: HookSetting[] | undefined,
  warn: (msg: string) => void = () => {},
): Promise<SettingsOwnership> {
  const ownership: SettingsOwnership = {};
  if (!settings && (!hookSettings || hookSettings.length === 0)) return ownership;

  const data = await readSettingsJson();

  if (settings?.env) {
    const env = (data.env ??= {});
    ownership.envKeys = [];
    for (const [key, value] of Object.entries(settings.env)) {
      if (key in env && env[key] !== value) {
        warn(`env.${key} already set to '${env[key]}', overwritten by '${value}' (pack ${packName})`);
      }
      env[key] = value;
      ownership.envKeys.push(key);
    }
  }

  if (settings?.permissions?.allow) {
    const perms = (data.permissions ??= {});
    const allow = (perms.allow ??= []);
    ownership.permissionsAllow = [];
    for (const rule of settings.permissions.allow) {
      if (!allow.includes(rule)) {
        allow.push(rule);
      }
      ownership.permissionsAllow.push(rule);
    }
  }

  if (settings?.extraKnownMarketplaces) {
    const m = (data.extraKnownMarketplaces ??= {});
    ownership.marketplaceKeys = [];
    for (const [key, value] of Object.entries(settings.extraKnownMarketplaces)) {
      if (key in m) {
        warn(`extraKnownMarketplaces.${key} already defined, overwritten by pack ${packName}`);
      }
      m[key] = value;
      ownership.marketplaceKeys.push(key);
    }
  }

  if (settings?.enabledPlugins) {
    const p = (data.enabledPlugins ??= {});
    ownership.pluginKeys = [];
    for (const [key, value] of Object.entries(settings.enabledPlugins)) {
      p[key] = value;
      ownership.pluginKeys.push(key);
    }
  }

  if (hookSettings && hookSettings.length > 0) {
    const hooksRoot = (data.hooks ??= {});
    ownership.hookCommands = [];
    for (const entry of hookSettings) {
      const eventArr = (hooksRoot[entry.event] ??= []);
      // group by matcher; create new group if matcher doesn't match an existing one
      const matcher = entry.matcher ?? '';
      let group = eventArr.find(g => (g.matcher ?? '') === matcher);
      if (!group) {
        group = { matcher: entry.matcher, hooks: [] };
        if (!entry.matcher) delete (group as { matcher?: string }).matcher;
        eventArr.push(group);
      }
      const exists = group.hooks.some(h => h.command === entry.command);
      if (!exists) {
        const hookEntry: Record<string, unknown> = {
          type: 'command',
          command: entry.command,
        };
        if (entry.statusMessage !== undefined) hookEntry.statusMessage = entry.statusMessage;
        if (entry.timeout !== undefined) hookEntry.timeout = entry.timeout;
        group.hooks.push(hookEntry);
      }
      ownership.hookCommands.push(entry.command);
    }
  }

  await writeSettingsJson(data);
  return ownership;
}

/** Reverses mergeSettings using the lockfile ownership record. */
export async function removeSettings(ownership: SettingsOwnership | undefined): Promise<void> {
  if (!ownership) return;
  const path = join(ROOT, SETTINGS_FILE);
  if (!(await exists(path))) return;
  const data = await readSettingsJson();

  if (ownership.envKeys && data.env) {
    for (const k of ownership.envKeys) delete data.env[k];
    if (Object.keys(data.env).length === 0) delete data.env;
  }

  if (ownership.permissionsAllow && data.permissions?.allow) {
    data.permissions.allow = data.permissions.allow.filter(
      r => !ownership.permissionsAllow!.includes(r),
    );
    if (data.permissions.allow.length === 0) delete data.permissions.allow;
    if (Object.keys(data.permissions).length === 0) delete data.permissions;
  }

  if (ownership.marketplaceKeys && data.extraKnownMarketplaces) {
    for (const k of ownership.marketplaceKeys) delete data.extraKnownMarketplaces[k];
    if (Object.keys(data.extraKnownMarketplaces).length === 0) delete data.extraKnownMarketplaces;
  }

  if (ownership.pluginKeys && data.enabledPlugins) {
    for (const k of ownership.pluginKeys) delete data.enabledPlugins[k];
    if (Object.keys(data.enabledPlugins).length === 0) delete data.enabledPlugins;
  }

  if (ownership.hookCommands && data.hooks) {
    for (const event of Object.keys(data.hooks)) {
      const groups = data.hooks[event];
      for (const group of groups) {
        group.hooks = group.hooks.filter(
          h => !ownership.hookCommands!.includes(h.command as string),
        );
      }
      data.hooks[event] = groups.filter(g => g.hooks.length > 0);
      if (data.hooks[event].length === 0) delete data.hooks[event];
    }
    if (Object.keys(data.hooks).length === 0) delete data.hooks;
  }

  await writeSettingsJson(data);
}

function renderBlock(ruleFilePaths: string[]): string {
  const refs = ruleFilePaths
    .filter(p => p.startsWith('.claude/rules/'))
    .map(p => `@${p}`)
    .sort();
  return [BLOCK_START, BLOCK_NOTICE, ...refs, BLOCK_END].join('\n');
}

export async function updateClaudeMdBlock(ruleFilePaths: string[]): Promise<void> {
  const path = join(ROOT, CLAUDE_MD_FILE);
  const block = renderBlock(ruleFilePaths);

  if (!(await exists(path))) {
    const scaffold = `# Project Instructions\n\n${block}\n`;
    await writeFile(path, scaffold);
    return;
  }

  const existing = await readFile(path, 'utf-8');
  const startIdx = existing.indexOf(BLOCK_START);
  const endIdx = existing.indexOf(BLOCK_END);

  let updated: string;
  if (startIdx === -1 || endIdx === -1) {
    updated = existing.trimEnd() + '\n\n' + block + '\n';
  } else {
    const before = existing.slice(0, startIdx).trimEnd();
    const after = existing.slice(endIdx + BLOCK_END.length).trimStart();
    const beforePart = before.length > 0 ? before + '\n\n' : '';
    const afterPart = after.length > 0 ? '\n\n' + after : '\n';
    updated = beforePart + block + afterPart;
  }
  await writeFile(path, updated);
}

export async function projectIsInitialized(): Promise<boolean> {
  return exists(join(ROOT, PROJECT_CONFIG_FILE));
}
