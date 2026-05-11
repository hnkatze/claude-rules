import { access } from 'node:fs/promises';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  installPackFiles,
  recordInstalls,
  resolveInstallOrder,
} from '../lib/install.js';
import {
  mergeMcps,
  readLockfile,
  readProjectConfig,
  removeInstalledFiles,
  ROOT,
} from '../lib/local.js';
import type { InstallResult, McpEntry } from '../types.js';

async function anyFileMissing(files: string[]): Promise<boolean> {
  for (const f of files) {
    try {
      await access(join(ROOT, f));
    } catch {
      return true;
    }
  }
  return false;
}

interface Options {
  yes?: boolean;
  mcps?: boolean;
}

export async function syncCommand(options: Options): Promise<void> {
  p.intro(pc.cyan('@hnkatze/claude-rules ') + pc.dim('sync'));

  const config = await readProjectConfig();
  const topLevel = Object.keys(config.packs);

  if (topLevel.length === 0) {
    p.log.warn('claude-rules.json has no packs. Nothing to sync.');
    p.outro(pc.dim('Run `claude-rules add <pack>` to add packs.'));
    return;
  }

  const sp = p.spinner();
  sp.start(`Resolving ${topLevel.length} top-level pack(s)`);
  let order;
  try {
    order = await resolveInstallOrder(topLevel);
  } catch (err) {
    sp.stop(pc.red('Failed to resolve dependencies'));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  sp.stop(`Resolved ${order.length} pack(s) (${topLevel.length} top-level + deps)`);

  const lock = await readLockfile();
  const toInstall = order.filter(m => !lock.packs[m.name]);
  const toUpdate = order.filter(m => {
    const installed = lock.packs[m.name];
    return installed && installed.version !== m.version;
  });

  // Detect packs whose lockfile entry is intact but files are missing on disk
  // (e.g. user manually deleted .claude/rules/foo.md). Treat as needing reinstall.
  const toRepair: typeof order = [];
  for (const m of order) {
    if (toInstall.includes(m) || toUpdate.includes(m)) continue;
    const entry = lock.packs[m.name];
    if (entry && entry.files.length > 0 && (await anyFileMissing(entry.files))) {
      toRepair.push(m);
    }
  }

  if (toInstall.length === 0 && toUpdate.length === 0 && toRepair.length === 0) {
    p.outro(pc.green('Project is already in sync.'));
    return;
  }

  console.log();
  console.log(pc.bold('Plan:'));
  for (const m of toInstall) {
    const tag = m.meta ? pc.magenta(' [meta]') : '';
    console.log(`  ${pc.green('+')} ${pc.bold(m.name)}@${m.version}${tag}`);
  }
  for (const m of toUpdate) {
    const old = lock.packs[m.name]!.version;
    console.log(`  ${pc.cyan('↑')} ${pc.bold(m.name)}  ${pc.dim(old)} → ${pc.cyan(m.version)}`);
  }
  for (const m of toRepair) {
    console.log(`  ${pc.yellow('↻')} ${pc.bold(m.name)}@${m.version}  ${pc.dim('(repair missing files)')}`);
  }
  console.log();

  if (!options.yes) {
    const confirm = await p.confirm({ message: 'Apply changes?' });
    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow('Cancelled.'));
      return;
    }
  }

  const newMcpAllowed = options.mcps !== false;

  // Collect MCPs from all packs being installed/updated (not repair — repair preserves MCPs)
  const allCandidateMcps: { packName: string; mcp: McpEntry }[] = [];
  for (const m of [...toInstall, ...toUpdate]) {
    const installedMcps = new Set(lock.packs[m.name]?.mcps ?? []);
    for (const mcp of m.mcps) {
      if (!installedMcps.has(mcp.name)) {
        allCandidateMcps.push({ packName: m.name, mcp });
      }
    }
  }

  let chosenMcps: { packName: string; mcp: McpEntry }[] = [];
  if (newMcpAllowed && allCandidateMcps.length > 0) {
    if (options.yes) {
      chosenMcps = allCandidateMcps;
    } else {
      const result = await p.multiselect({
        message: `Install ${allCandidateMcps.length} MCP(s)? (all preselected — uncheck to skip)`,
        options: allCandidateMcps.map(({ packName, mcp }) => ({
          label: `${pc.bold(mcp.name)} ${pc.dim('(from ' + packName + ')')}`,
          value: `${packName}::${mcp.name}`,
        })),
        initialValues: allCandidateMcps.map(({ packName, mcp }) => `${packName}::${mcp.name}`),
        required: false,
      });
      if (p.isCancel(result)) {
        p.outro(pc.yellow('Cancelled.'));
        return;
      }
      const chosen = new Set(result);
      chosenMcps = allCandidateMcps.filter(({ packName, mcp }) =>
        chosen.has(`${packName}::${mcp.name}`),
      );
    }
  }

  const mcpsByPack = new Map<string, McpEntry[]>();
  for (const { packName, mcp } of chosenMcps) {
    const list = mcpsByPack.get(packName) ?? [];
    list.push(mcp);
    mcpsByPack.set(packName, list);
  }

  const results: InstallResult[] = [];
  for (const manifest of [...toInstall, ...toUpdate, ...toRepair]) {
    const ssp = p.spinner();
    ssp.start(`Installing ${manifest.name}@${manifest.version}`);
    try {
      const existing = lock.packs[manifest.name];
      if (existing) {
        await removeInstalledFiles(existing.files);
      }
      const files = await installPackFiles(manifest);
      const newlyMerged = await mergeMcps(mcpsByPack.get(manifest.name) ?? []);
      const existingMcps = existing?.mcps ?? [];
      const allMcps = Array.from(new Set([...existingMcps, ...newlyMerged]));
      results.push({ manifest, files, mcps: allMcps });
      ssp.stop(
        pc.green('✓ ') +
          pc.bold(`${manifest.name}@${manifest.version}`) +
          pc.dim(`  ${files.length} files, ${allMcps.length} mcps`),
      );
    } catch (err) {
      ssp.stop(pc.red(`✗ ${manifest.name}`));
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (results.length > 0) {
    await recordInstalls(results, topLevel);
  }

  p.outro(
    pc.green(`Synced ${results.length} pack(s). `) + pc.dim('Project matches claude-rules.json.'),
  );
}
