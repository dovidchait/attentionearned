import { Command } from 'commander';
import { importCommand } from './commands/import.js';
import {
  mediaIngestCommand,
  mediaReleaseCommand,
  mediaNoSubjectsCommand,
  subjectEnrollCommand,
  subjectTagCommand,
  subjectLinkCommand,
  subjectConsentCommand,
} from './commands/media.js';
import {
  templateUpsertCommand,
  templateListCommand,
  sendTouchCommand,
  webhooksServeCommand,
} from './commands/channels.js';

const program = new Command('stewardship');

program
  .name('stewardship')
  .description('Donor Stewardship Engine CLI')
  .version('0.1.0');

program.addCommand(importCommand);
program.addCommand(mediaIngestCommand);
program.addCommand(mediaReleaseCommand);
program.addCommand(mediaNoSubjectsCommand);
program.addCommand(subjectEnrollCommand);
program.addCommand(subjectTagCommand);
program.addCommand(subjectLinkCommand);
program.addCommand(subjectConsentCommand);
program.addCommand(templateUpsertCommand);
program.addCommand(templateListCommand);
program.addCommand(sendTouchCommand);
program.addCommand(webhooksServeCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error('Fatal:', err.message);
  process.exitCode = 1;
});
