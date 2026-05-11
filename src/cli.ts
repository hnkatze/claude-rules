import { cac } from 'cac';
import pc from 'picocolors';
import { addCommand } from './commands/add.js';
import { availableCommand } from './commands/available.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { syncCommand } from './commands/sync.js';
import { updateCommand } from './commands/update.js';

// @clack/prompts adds temporary unhandledRejection listeners per spinner; with
// 9+ spinners in a row we hit Node's default 10-listener warning. Bump it.
process.setMaxListeners(30);

const cli = cac('claude-rules');

cli
  .command('init', 'Initialize project: scaffold claude-rules.json + managed block in CLAUDE.md')
  .action(initCommand);

cli
  .command('available', 'List packs available in the registry')
  .action(availableCommand);

cli
  .command('add <...packs>', 'Install one or more packs (resolves deps and offers MCP installation)')
  .option('--no-mcps', 'Skip the MCP installation prompt')
  .option('-y, --yes', 'Skip all confirmation prompts (non-interactive)')
  .action(addCommand);

cli
  .command('list', 'Show installed packs and versions')
  .alias('ls')
  .action(listCommand);

cli
  .command('remove <pack>', 'Uninstall a pack (removes its files and MCP entries)')
  .alias('rm')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(removeCommand);

cli
  .command('update [pack]', 'Update installed packs to their latest version in the registry')
  .option('--no-mcps', 'Skip prompts about newly-added MCPs')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(updateCommand);

cli
  .command('sync', 'Install + update packs to match what claude-rules.json declares')
  .option('--no-mcps', 'Skip MCP installation prompts')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(syncCommand);

cli
  .command('doctor', 'Diagnose drift between claude-rules.json, lockfile, .claude/, .mcp.json, and CLAUDE.md')
  .option('--fix', 'Auto-repair fixable findings (e.g. regenerate CLAUDE.md block)')
  .action(doctorCommand);

cli.help();
cli.version('0.2.0');

try {
  cli.parse();
} catch (err) {
  console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
  process.exit(1);
}

process.on('unhandledRejection', err => {
  console.error(pc.red('Unhandled error:'), err instanceof Error ? err.message : err);
  process.exit(1);
});
