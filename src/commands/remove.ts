import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findOrphans, uninstallPacks } from '../lib/install.js';
import { readLockfile, readProjectConfig } from '../lib/local.js';

interface Options {
  yes?: boolean;
}

export async function removeCommand(pack: string, options: Options): Promise<void> {
  p.intro(pc.cyan('@hnkatze/claude-rules ') + pc.dim('remove ' + pack));

  const lock = await readLockfile();
  const config = await readProjectConfig();
  const entry = lock.packs[pack];
  if (!entry) {
    p.log.error(`Pack '${pack}' is not installed.`);
    p.outro(pc.yellow('Nothing to do.'));
    process.exit(1);
  }

  const topLevelDependents = Object.keys(config.packs)
    .filter(n => n !== pack)
    .filter(n => lock.packs[n]?.dependencies.includes(pack));

  if (topLevelDependents.length > 0) {
    p.log.warn(
      `These top-level packs depend on '${pack}': ${pc.bold(topLevelDependents.join(', '))}`,
    );
    p.log.message(pc.dim('Removing will likely break them.'));
    if (!options.yes) {
      const confirm = await p.confirm({ message: 'Remove anyway?', initialValue: false });
      if (p.isCancel(confirm) || !confirm) {
        p.outro(pc.yellow('Cancelled.'));
        return;
      }
    }
  } else if (!options.yes) {
    const confirm = await p.confirm({
      message: `Remove ${pc.bold(pack)} (${entry.files.length} files, ${entry.mcps.length} mcps)?`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.outro(pc.yellow('Cancelled.'));
      return;
    }
  }

  const sp = p.spinner();
  sp.start(`Removing ${pack}`);
  try {
    await uninstallPacks([pack]);
    sp.stop(pc.green(`✓ Removed ${pack}`));
  } catch (err) {
    sp.stop(pc.red(`✗ Failed to remove ${pack}`));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Orphan detection: packs left in lockfile that no top-level pack requires
  const newConfig = await readProjectConfig();
  const newLock = await readLockfile();
  const orphans = findOrphans(newConfig, newLock);

  if (orphans.length === 0) {
    p.outro(pc.green('Done. ') + pc.dim('CLAUDE.md updated.'));
    return;
  }

  const totalFiles = orphans.reduce((acc, n) => acc + (newLock.packs[n]?.files.length ?? 0), 0);
  const totalMcps = orphans.reduce((acc, n) => acc + (newLock.packs[n]?.mcps.length ?? 0), 0);

  p.log.info(
    `Found ${pc.bold(String(orphans.length))} orphan pack(s) ` +
      pc.dim(`(${totalFiles} files, ${totalMcps} mcps total)`),
  );

  let toRemove: string[] = [];

  if (options.yes) {
    toRemove = orphans;
  } else {
    const result = await p.multiselect({
      message: 'These packs were installed as deps but nothing requires them now. Remove?',
      options: orphans.map(name => {
        const e = newLock.packs[name]!;
        return {
          label: `${pc.bold(name)}@${e.version} ${pc.dim(`(${e.files.length} files, ${e.mcps.length} mcps)`)}`,
          value: name,
        };
      }),
      initialValues: orphans,
      required: false,
    });
    if (p.isCancel(result)) {
      p.outro(pc.yellow('Kept orphans. Done.'));
      return;
    }
    toRemove = result as string[];
  }

  if (toRemove.length === 0) {
    p.outro(pc.yellow('Kept all orphans. Done.'));
    return;
  }

  const orphanSp = p.spinner();
  orphanSp.start(`Removing ${toRemove.length} orphan(s)`);
  try {
    const result = await uninstallPacks(toRemove);
    orphanSp.stop(pc.green(`✓ Removed ${result.removed.length} orphan(s)`));
  } catch (err) {
    orphanSp.stop(pc.red('✗ Failed during orphan cleanup'));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  p.outro(pc.green('Done. ') + pc.dim('CLAUDE.md updated.'));
}
