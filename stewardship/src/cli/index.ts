import { Command } from 'commander';
import { importCommand } from './commands/import.js';

const program = new Command('stewardship');

program
  .name('stewardship')
  .description('Donor Stewardship Engine CLI')
  .version('0.1.0');

program.addCommand(importCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error('Fatal:', err.message);
  process.exitCode = 1;
});
