import pc from 'picocolors';
import { fetchRegistry } from '../lib/registry.js';

export async function availableCommand(): Promise<void> {
  const registry = await fetchRegistry();
  const entries = Object.entries(registry.packs);
  const base = entries.filter(([, e]) => !e.meta);
  const meta = entries.filter(([, e]) => e.meta);

  console.log();
  console.log(
    pc.bold(pc.cyan('Available packs')) +
      pc.dim(`  (registry updated ${registry.updatedAt})`),
  );

  console.log();
  console.log(pc.bold('Base packs:'));
  for (const [name, entry] of base) {
    console.log(
      `  ${pc.green(name.padEnd(18))} ${pc.dim(entry.tags.join(',').padEnd(28))} ${entry.description}`,
    );
  }

  if (meta.length > 0) {
    console.log();
    console.log(pc.bold('Meta packs (bundles):'));
    for (const [name, entry] of meta) {
      console.log(
        `  ${pc.magenta(name.padEnd(18))} ${pc.dim(entry.tags.join(',').padEnd(28))} ${entry.description}`,
      );
    }
  }

  console.log();
  console.log(pc.dim('  Install with:  claude-rules add <pack>'));
  console.log();
}
