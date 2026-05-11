import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  projectIsInitialized,
  updateClaudeMdBlock,
  writeProjectConfig,
} from '../lib/local.js';

export async function initCommand(): Promise<void> {
  p.intro(pc.cyan('@hnkatze/claude-rules ') + pc.dim('init'));

  if (await projectIsInitialized()) {
    p.log.warn('claude-rules.json already exists — leaving it untouched.');
  } else {
    await writeProjectConfig({ packs: {} });
    p.log.success('Created claude-rules.json');
  }

  await updateClaudeMdBlock([]);
  p.log.success('CLAUDE.md ready (managed block initialized)');

  p.outro(
    pc.green('Done. ') +
      pc.dim('Next: ') +
      pc.cyan('claude-rules available') +
      pc.dim(' to see what you can install.'),
  );
}
