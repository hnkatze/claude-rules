import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  installPackFiles,
  installPackSettings,
  recordInstalls,
} from '../lib/install.js';
import {
  mergeMcps,
  readLockfile,
  removeInstalledFiles,
  removeSettings,
} from '../lib/local.js';
import { fetchManifest } from '../lib/registry.js';
import type { InstallResult, Manifest, McpEntry } from '../types.js';

interface Options {
  yes?: boolean;
  mcps?: boolean;
}

interface PendingUpdate {
  name: string;
  currentVersion: string;
  manifest: Manifest;
  newMcps: McpEntry[];
}

export async function updateCommand(
  packName: string | undefined,
  options: Options,
): Promise<void> {
  p.intro(
    pc.cyan('@hnkatze/claude-rules ') + pc.dim('update' + (packName ? ' ' + packName : '')),
  );

  const lock = await readLockfile();
  const targets = packName ? [packName] : Object.keys(lock.packs);

  if (targets.length === 0) {
    p.log.warn('No packs installed.');
    p.outro(pc.dim('Nothing to update.'));
    return;
  }

  if (packName && !lock.packs[packName]) {
    p.log.error(`Pack '${packName}' is not installed.`);
    process.exit(1);
  }

  const sp = p.spinner();
  sp.start(`Checking ${targets.length} pack(s) for updates`);

  const pending: PendingUpdate[] = [];
  const errors: { name: string; err: string }[] = [];
  for (const name of targets) {
    try {
      const manifest = await fetchManifest(name);
      const currentVersion = lock.packs[name]?.version ?? '0.0.0';
      if (manifest.version !== currentVersion) {
        const installedMcps = new Set(lock.packs[name]?.mcps ?? []);
        const newMcps = manifest.mcps.filter(m => !installedMcps.has(m.name));
        pending.push({ name, currentVersion, manifest, newMcps });
      }
    } catch (err) {
      errors.push({ name, err: err instanceof Error ? err.message : String(err) });
    }
  }
  sp.stop(`Checked ${targets.length} pack(s)`);

  for (const e of errors) {
    p.log.warn(`${e.name}: ${e.err}`);
  }

  if (pending.length === 0) {
    p.outro(pc.green('All packs are up to date.'));
    return;
  }

  console.log();
  console.log(pc.bold('Updates available:'));
  for (const u of pending) {
    console.log(
      `  ${pc.green('↑')} ${pc.bold(u.name)}  ${pc.dim(u.currentVersion)} → ${pc.cyan(u.manifest.version)}` +
        (u.newMcps.length > 0 ? pc.dim(`  (+${u.newMcps.length} new mcps)`) : ''),
    );
  }
  console.log();

  if (!options.yes) {
    const confirm = await p.confirm({ message: 'Apply updates?' });
    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow('Cancelled.'));
      return;
    }
  }

  const newMcpAllowed = options.mcps !== false;

  const results: InstallResult[] = [];
  for (const u of pending) {
    const ssp = p.spinner();
    ssp.start(`Updating ${u.name} → ${u.manifest.version}`);
    try {
      const oldEntry = lock.packs[u.name];
      await removeInstalledFiles(oldEntry?.files ?? []);
      await removeSettings(oldEntry?.settingsKeys);

      const { all, agents, hookScripts } = await installPackFiles(u.manifest);

      let mcpsToMerge: McpEntry[] = [];
      if (newMcpAllowed && u.newMcps.length > 0) {
        mcpsToMerge = options.yes ? u.newMcps : [];
        if (!options.yes) {
          ssp.stop(pc.dim(`Asking about ${u.newMcps.length} new MCP(s) for ${u.name}`));
          const result = await p.multiselect({
            message: `New MCPs added to ${u.name}@${u.manifest.version} — install which?`,
            options: u.newMcps.map(m => ({
              label: pc.bold(m.name),
              value: m.name,
            })),
            initialValues: u.newMcps.map(m => m.name),
            required: false,
          });
          if (!p.isCancel(result)) {
            const chosen = new Set(result);
            mcpsToMerge = u.newMcps.filter(m => chosen.has(m.name));
          }
          ssp.start(`Updating ${u.name} → ${u.manifest.version}`);
        }
      }

      const newlyMerged = await mergeMcps(mcpsToMerge);
      const existing = lock.packs[u.name]?.mcps ?? [];
      const allMcps = Array.from(new Set([...existing, ...newlyMerged]));
      const settingsKeys = await installPackSettings(u.manifest, msg => p.log.warn(msg));

      const manifestForResult: Manifest = u.manifest;
      const extras: string[] = [];
      if (agents.length > 0) extras.push(`${agents.length} agents`);
      if (hookScripts.length > 0) extras.push(`${hookScripts.length} hooks`);
      results.push({
        manifest: manifestForResult,
        files: all,
        mcps: allMcps,
        agents,
        hookScripts,
        settingsKeys,
      });
      ssp.stop(
        pc.green('✓ ') +
          pc.bold(`${u.name}@${u.manifest.version}`) +
          pc.dim(
            `  ${all.length} files, ${allMcps.length} mcps${extras.length > 0 ? ', ' + extras.join(', ') : ''}`,
          ),
      );
    } catch (err) {
      ssp.stop(pc.red(`✗ ${u.name}`));
      p.log.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (results.length > 0) {
    await recordInstalls(results, []);
  }

  p.outro(
    pc.green(`Updated ${results.length} pack(s). `) + pc.dim('Lockfile + CLAUDE.md refreshed.'),
  );
}
