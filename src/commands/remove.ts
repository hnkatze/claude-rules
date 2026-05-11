import * as p from '@clack/prompts';
import pc from 'picocolors';
import { uninstallPack } from '../lib/install.js';
import { readLockfile } from '../lib/local.js';

interface Options {
  yes?: boolean;
}

export async function removeCommand(pack: string, options: Options): Promise<void> {
  p.intro(pc.cyan('@hnkatze/claude-rules ') + pc.dim('remove ' + pack));

  const lock = await readLockfile();
  const entry = lock.packs[pack];
  if (!entry) {
    p.log.error(`Pack '${pack}' is not installed.`);
    p.outro(pc.yellow('Nothing to do.'));
    process.exit(1);
  }

  const dependents = Object.entries(lock.packs)
    .filter(([n, e]) => n !== pack && e.dependencies.includes(pack))
    .map(([n]) => n);

  if (dependents.length > 0) {
    p.log.warn(
      `These installed packs depend on '${pack}': ${pc.bold(dependents.join(', '))}`,
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
    await uninstallPack(pack);
    sp.stop(pc.green(`✓ Removed ${pack}`));
  } catch (err) {
    sp.stop(pc.red(`✗ Failed to remove ${pack}`));
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  p.outro(pc.green('Done. ') + pc.dim('CLAUDE.md updated.'));
}
