import pc from 'picocolors';
import { readLockfile, readProjectConfig } from '../lib/local.js';

export async function listCommand(): Promise<void> {
  const config = await readProjectConfig();
  const lock = await readLockfile();
  const names = Object.keys(lock.packs).sort();

  if (names.length === 0) {
    console.log();
    console.log(pc.dim('  No packs installed.'));
    console.log(
      pc.dim('  Run ') +
        pc.cyan('claude-rules add <pack>') +
        pc.dim(' to install one, or ') +
        pc.cyan('claude-rules available') +
        pc.dim(' to see options.'),
    );
    console.log();
    return;
  }

  console.log();
  console.log(pc.bold('Installed packs:'));
  for (const name of names) {
    const entry = lock.packs[name]!;
    const range = config.packs[name] ?? pc.red('(not in claude-rules.json)');
    console.log(
      `  ${pc.green(name.padEnd(18))} ` +
        `${pc.cyan('v' + entry.version).padEnd(12)} ` +
        `${pc.dim('range: ' + range).padEnd(20)} ` +
        `${pc.dim(entry.files.length + ' files, ' + entry.mcps.length + ' mcps')}`,
    );
  }
  console.log();
}
