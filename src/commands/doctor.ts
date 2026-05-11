import * as p from '@clack/prompts';
import pc from 'picocolors';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readLockfile,
  readProjectConfig,
  ROOT,
  updateClaudeMdBlock,
} from '../lib/local.js';
import { fetchManifest } from '../lib/registry.js';

interface Options {
  fix?: boolean;
}

interface Finding {
  severity: 'error' | 'warn' | 'info';
  message: string;
  fixable: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function doctorCommand(options: Options): Promise<void> {
  p.intro(pc.cyan('@hnkatze/claude-rules ') + pc.dim('doctor'));

  const config = await readProjectConfig();
  const lock = await readLockfile();
  const findings: Finding[] = [];

  // 1. Top-level packs in config that aren't in lockfile
  for (const name of Object.keys(config.packs)) {
    if (!lock.packs[name]) {
      findings.push({
        severity: 'error',
        message: `Pack '${name}' is in claude-rules.json but NOT in lockfile (run \`sync\`).`,
        fixable: false,
      });
    }
  }

  // 2. Missing files (lockfile says installed but file doesn't exist on disk)
  for (const [name, entry] of Object.entries(lock.packs)) {
    for (const file of entry.files) {
      if (!(await exists(join(ROOT, file)))) {
        findings.push({
          severity: 'error',
          message: `${name}: missing file '${file}' (run \`update ${name}\` or \`sync\`).`,
          fixable: false,
        });
      }
    }
  }

  // 3. Missing MCPs (lockfile says merged but not in .mcp.json)
  const mcpJsonPath = join(ROOT, '.mcp.json');
  let mcpServers: Record<string, unknown> = {};
  if (await exists(mcpJsonPath)) {
    try {
      const raw = JSON.parse(await readFile(mcpJsonPath, 'utf-8')) as { mcpServers?: Record<string, unknown> };
      mcpServers = raw.mcpServers ?? {};
    } catch (err) {
      findings.push({
        severity: 'error',
        message: `.mcp.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        fixable: false,
      });
    }
  }
  for (const [name, entry] of Object.entries(lock.packs)) {
    for (const mcpName of entry.mcps) {
      if (!(mcpName in mcpServers)) {
        findings.push({
          severity: 'warn',
          message: `${name}: MCP '${mcpName}' missing from .mcp.json (was it manually removed?).`,
          fixable: false,
        });
      }
    }
  }

  // 3b. Settings drift (.claude/settings.json missing keys the lockfile says were merged)
  const settingsJsonPath = join(ROOT, '.claude', 'settings.json');
  let settings: {
    env?: Record<string, string>;
    permissions?: { allow?: string[] };
    extraKnownMarketplaces?: Record<string, unknown>;
    enabledPlugins?: Record<string, boolean>;
    hooks?: Record<string, Array<{ hooks: Array<{ command?: string }> }>>;
  } = {};
  if (await exists(settingsJsonPath)) {
    try {
      settings = JSON.parse(await readFile(settingsJsonPath, 'utf-8'));
    } catch (err) {
      findings.push({
        severity: 'error',
        message: `.claude/settings.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        fixable: false,
      });
    }
  }
  for (const [name, entry] of Object.entries(lock.packs)) {
    const o = entry.settingsKeys;
    if (!o) continue;
    for (const k of o.envKeys ?? []) {
      if (!settings.env || !(k in settings.env)) {
        findings.push({
          severity: 'warn',
          message: `${name}: env '${k}' missing from .claude/settings.json (manually removed?).`,
          fixable: false,
        });
      }
    }
    for (const rule of o.permissionsAllow ?? []) {
      if (!settings.permissions?.allow?.includes(rule)) {
        findings.push({
          severity: 'warn',
          message: `${name}: permissions.allow '${rule}' missing from .claude/settings.json.`,
          fixable: false,
        });
      }
    }
    for (const cmd of o.hookCommands ?? []) {
      const found = Object.values(settings.hooks ?? {}).some(arr =>
        arr.some(g => g.hooks.some(h => h.command === cmd)),
      );
      if (!found) {
        findings.push({
          severity: 'warn',
          message: `${name}: hook command '${cmd}' missing from .claude/settings.json.`,
          fixable: false,
        });
      }
    }
  }

  // 4. CLAUDE.md block out of sync with lockfile rule files
  const claudeMdPath = join(ROOT, 'CLAUDE.md');
  if (await exists(claudeMdPath)) {
    const md = await readFile(claudeMdPath, 'utf-8');
    const startIdx = md.indexOf('<!-- @hnkatze/claude-rules:start -->');
    const endIdx = md.indexOf('<!-- @hnkatze/claude-rules:end -->');
    if (startIdx === -1 || endIdx === -1) {
      findings.push({
        severity: 'warn',
        message: `CLAUDE.md is missing the managed block (run \`init\` or any add/remove to recreate).`,
        fixable: true,
      });
    } else {
      const block = md.slice(startIdx, endIdx);
      const expectedRefs = Object.values(lock.packs)
        .flatMap(p => p.files)
        .filter(f => f.startsWith('.claude/rules/'))
        .sort();
      const inBlock = expectedRefs.every(ref => block.includes(`@${ref}`));
      if (!inBlock) {
        findings.push({
          severity: 'warn',
          message: `CLAUDE.md managed block is out of sync with lockfile rule files.`,
          fixable: true,
        });
      }
    }
  } else if (Object.keys(lock.packs).length > 0) {
    findings.push({
      severity: 'warn',
      message: `CLAUDE.md does not exist but packs are installed (run \`init\`).`,
      fixable: true,
    });
  }

  // 5. Drift: registry has newer versions
  const sp = p.spinner();
  sp.start('Checking registry for newer versions');
  let outdated = 0;
  for (const [name, entry] of Object.entries(lock.packs)) {
    try {
      const manifest = await fetchManifest(name);
      if (manifest.version !== entry.version) {
        findings.push({
          severity: 'info',
          message: `${name}: ${entry.version} → ${manifest.version} available (run \`update ${name}\`).`,
          fixable: false,
        });
        outdated++;
      }
    } catch {
      // ignore; doctor stays best-effort on network
    }
  }
  sp.stop(`Registry check complete (${outdated} outdated)`);

  // Report
  if (findings.length === 0) {
    p.outro(pc.green('✓ Everything looks healthy.'));
    return;
  }

  console.log();
  console.log(pc.bold('Findings:'));
  for (const f of findings) {
    const tag =
      f.severity === 'error' ? pc.red('  ✗') : f.severity === 'warn' ? pc.yellow('  ⚠') : pc.cyan('  ℹ');
    console.log(`${tag} ${f.message}`);
  }
  console.log();

  if (options.fix) {
    const fixable = findings.filter(f => f.fixable);
    if (fixable.length === 0) {
      p.log.warn('No auto-fixable findings. Manual action needed for the rest.');
      p.outro(pc.yellow('Done.'));
      return;
    }
    p.log.info(`Auto-fixing ${fixable.length} finding(s)`);
    const allRuleFiles = Object.values(lock.packs).flatMap(p => p.files);
    await updateClaudeMdBlock(allRuleFiles);
    p.outro(pc.green('Fixed CLAUDE.md block. Re-run `doctor` to verify.'));
    return;
  }

  const summary =
    `${findings.filter(f => f.severity === 'error').length} error(s), ` +
    `${findings.filter(f => f.severity === 'warn').length} warning(s), ` +
    `${findings.filter(f => f.severity === 'info').length} info`;
  p.outro(pc.yellow(summary) + pc.dim('  — run `doctor --fix` to repair fixable issues.'));
}
