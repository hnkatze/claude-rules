import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { Lockfile, McpEntry, ProjectConfig } from '../types.js';

const PROJECT_CONFIG_FILE = 'claude-rules.json';
const LOCKFILE = 'claude-rules.lock.json';
const MCP_FILE = '.mcp.json';
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
  if (top !== 'rules' && top !== 'skills' && top !== 'agents') return null;
  return join(ROOT, '.claude', relPath);
}

export async function installFile(relPath: string, content: string): Promise<string | null> {
  const dest = resolveInstallPath(relPath);
  if (!dest) return null;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, content);
  return relative(ROOT, dest).replaceAll('\\', '/');
}

export async function removeInstalledFiles(files: string[]): Promise<void> {
  for (const file of files) {
    const path = join(ROOT, file);
    if (await exists(path)) await rm(path, { force: true });
  }
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
