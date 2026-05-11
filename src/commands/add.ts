import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  installPackFiles,
  installPackSettings,
  recordInstalls,
  resolveInstallOrder,
} from '../lib/install.js';
import { mergeMcps, readLockfile, readProjectConfig } from '../lib/local.js';
import type { InstallResult, Manifest, McpEntry } from '../types.js';

interface Options {
  mcps?: boolean;
  yes?: boolean;
}

interface CollectedMcp {
  packName: string;
  mcp: McpEntry;
}

export async function addCommand(packs: string[] | string, options: Options): Promise<void> {
  const packList = Array.isArray(packs) ? packs : [packs];
  if (packList.length === 0) {
    console.error(pc.red('Error:'), 'specify at least one pack to install.');
    process.exit(1);
  }

  p.intro(pc.cyan('@hnkatze/claude-rules ') + pc.dim('add ' + packList.join(' ')));

  const installMcpsAllowed = options.mcps !== false;

  const resolveSpinner = p.spinner();
  resolveSpinner.start('Resolving dependencies');
  let order: Manifest[];
  try {
    order = await resolveInstallOrder(packList);
  } catch (err) {
    resolveSpinner.stop(pc.red('Failed to resolve dependencies'));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  resolveSpinner.stop(`Resolved ${pc.bold(String(order.length))} pack(s)`);

  const lock = await readLockfile();
  const config = await readProjectConfig();
  const toInstall = order.filter(m => !lock.packs[m.name]);
  const skipped = order.filter(m => lock.packs[m.name]);
  const requestedMissingFromConfig = packList.filter(name => !config.packs[name]);

  if (toInstall.length === 0 && requestedMissingFromConfig.length === 0) {
    p.log.warn('All requested packs are already installed and tracked.');
    p.outro(pc.dim('Nothing to do.'));
    return;
  }

  if (toInstall.length === 0 && requestedMissingFromConfig.length > 0) {
    p.log.info(
      `Already installed — marking as top-level: ${pc.bold(requestedMissingFromConfig.join(', '))}`,
    );
    await recordInstalls([], packList);
    p.outro(pc.green('claude-rules.json updated.'));
    return;
  }

  console.log();
  console.log(pc.bold('Plan:'));
  for (const m of toInstall) {
    const tag = m.meta ? pc.magenta(' [meta]') : '';
    const desc = m.description.length > 60 ? m.description.slice(0, 57) + '...' : m.description;
    console.log(`  ${pc.green('+')} ${pc.bold(m.name)}@${m.version}${tag}  ${pc.dim(desc)}`);
  }
  for (const m of skipped) {
    console.log(`  ${pc.dim('= ' + m.name + '@' + m.version + '  (already installed)')}`);
  }
  console.log();

  if (!options.yes) {
    const confirm = await p.confirm({ message: 'Proceed with installation?' });
    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow('Cancelled.'));
      return;
    }
  }

  const allMcps: CollectedMcp[] = toInstall.flatMap(m =>
    m.mcps.map(mcp => ({ packName: m.name, mcp })),
  );

  let chosenMcps: CollectedMcp[] = [];
  if (installMcpsAllowed && allMcps.length > 0) {
    if (options.yes) {
      chosenMcps = allMcps;
    } else {
      const result = await p.multiselect({
        message: 'Which MCPs do you want to install in .mcp.json? (all preselected — uncheck to skip)',
        options: allMcps.map(({ packName, mcp }) => ({
          label: `${pc.bold(mcp.name)} ${pc.dim('(from ' + packName + ')')}`,
          value: `${packName}::${mcp.name}`,
        })),
        initialValues: allMcps.map(({ packName, mcp }) => `${packName}::${mcp.name}`),
        required: false,
      });
      if (p.isCancel(result)) {
        p.outro(pc.yellow('Cancelled.'));
        return;
      }
      const chosen = new Set(result);
      chosenMcps = allMcps.filter(({ packName, mcp }) => chosen.has(`${packName}::${mcp.name}`));
    }
  }

  const mcpsByPack = new Map<string, McpEntry[]>();
  for (const { packName, mcp } of chosenMcps) {
    const list = mcpsByPack.get(packName) ?? [];
    list.push(mcp);
    mcpsByPack.set(packName, list);
  }

  const results: InstallResult[] = [];
  for (const manifest of toInstall) {
    const sp = p.spinner();
    sp.start(`Installing ${manifest.name}@${manifest.version}`);
    try {
      const { all, agents, hookScripts } = await installPackFiles(manifest);
      const mcps = await mergeMcps(mcpsByPack.get(manifest.name) ?? []);
      const settingsKeys = await installPackSettings(manifest, msg => p.log.warn(msg));
      const extras: string[] = [];
      if (agents.length > 0) extras.push(`${agents.length} agents`);
      if (hookScripts.length > 0) extras.push(`${hookScripts.length} hooks`);
      sp.stop(
        pc.green('✓ ') +
          pc.bold(`${manifest.name}@${manifest.version}`) +
          pc.dim(
            `  ${all.length} files, ${mcps.length} mcps${extras.length > 0 ? ', ' + extras.join(', ') : ''}`,
          ),
      );
      results.push({ manifest, files: all, mcps, agents, hookScripts, settingsKeys });
    } catch (err) {
      sp.stop(pc.red(`✗ ${manifest.name}@${manifest.version}`));
      p.log.error(err instanceof Error ? err.message : String(err));
      if (results.length > 0) {
        await recordInstalls(results, packList);
        p.log.warn(`Recorded ${results.length} successful pack(s) before failure.`);
      }
      process.exit(1);
    }
  }

  await recordInstalls(results, packList);

  p.outro(
    pc.green(`Installed ${results.length} pack(s). `) +
      pc.dim('CLAUDE.md updated, lockfile written.'),
  );
}
