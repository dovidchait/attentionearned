import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { orgs, donors } from '../../schema/index.js';
import { ingestAsset } from '../../media/ingest.js';
import { enrollSubject, tagAssetToSubject, linkDonorToSubject, confirmRelease, confirmPhotoConsent, markNoSubjects } from '../../media/subjects.js';

export const mediaIngestCommand = new Command('media:ingest')
  .description('Ingest a local file or remote URI as a media asset')
  .argument('<file-or-uri>', 'Local file path or https:// URI')
  .requiredOption('--org <slug>', 'Org slug')
  .option('--tag <tag...>', 'Tags to apply (repeatable)')
  .option('--designation <id>', 'Designation UUID to associate with this asset')
  .option('--expires <date>', 'Expiry date (ISO 8601, e.g. 2025-12-31)')
  .action(async (fileOrUri: string, opts: { org: string; tag?: string[]; designation?: string; expires?: string }) => {
    const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, opts.org));
    if (!org) { console.error(`Org not found: ${opts.org}`); process.exitCode = 1; return; }

    const asset = await ingestAsset(fileOrUri, org.id, {
      tags: opts.tag,
      designationId: opts.designation,
      expiresAt: opts.expires ? new Date(opts.expires) : undefined,
    });

    console.log(`Asset ingested: ${asset.id}`);
    console.log(`  kind: ${asset.kind}, taggingState: ${asset.taggingState}`);
    console.log(`  releaseOnFile: ${asset.releaseOnFile} (run media:release to set to true)`);
  });

export const mediaReleaseCommand = new Command('media:release')
  .description('Confirm that release/consent is on file for an asset (allows it to be sent)')
  .requiredOption('--asset <id>', 'Asset UUID')
  .requiredOption('--confirmed-by <operator>', 'Your name or ID (for audit log)')
  .action(async (opts: { asset: string; confirmedBy: string }) => {
    await confirmRelease(opts.asset, opts.confirmedBy);
    console.log(`release_on_file=true set on asset ${opts.asset}`);
  });

export const mediaNoSubjectsCommand = new Command('media:no-subjects')
  .description('Mark an asset as having no identifiable subjects')
  .requiredOption('--asset <id>', 'Asset UUID')
  .action(async (opts: { asset: string }) => {
    await markNoSubjects(opts.asset);
    console.log(`taggingState=no_subjects set on asset ${opts.asset}`);
  });

export const subjectEnrollCommand = new Command('subject:enroll')
  .description('Enroll a new subject (child) in the system')
  .requiredOption('--org <slug>', 'Org slug')
  .requiredOption('--name <displayName>', 'Internal display name (e.g. "Dovid G.")')
  .action(async (opts: { org: string; name: string }) => {
    const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, opts.org));
    if (!org) { console.error(`Org not found: ${opts.org}`); process.exitCode = 1; return; }

    const subject = await enrollSubject(org.id, opts.name);
    console.log(`Subject enrolled: ${subject.id}`);
    console.log(`  displayName: ${subject.displayName}`);
    console.log(`  photoConsentOnFile: ${subject.photoConsentOnFile} (run subject:consent to set to true)`);
  });

export const subjectTagCommand = new Command('subject:tag')
  .description('Tag an asset as containing a subject (manual human confirmation)')
  .requiredOption('--asset <id>', 'Asset UUID')
  .requiredOption('--subject <id>', 'Subject UUID')
  .requiredOption('--confirmed-by <operator>', 'Your name or ID')
  .action(async (opts: { asset: string; subject: string; confirmedBy: string }) => {
    const tag = await tagAssetToSubject(opts.asset, opts.subject, opts.confirmedBy);
    console.log(`Asset ${opts.asset} tagged to subject ${opts.subject} (method: ${tag.method})`);
  });

export const subjectLinkCommand = new Command('subject:link')
  .description('Link a donor to a subject (e.g. parent → child)')
  .requiredOption('--donor <id>', 'Donor UUID')
  .requiredOption('--subject <id>', 'Subject UUID')
  .requiredOption('--relationship <type>', 'parent | grandparent | other')
  .requiredOption('--verified-by <operator>', 'Your name or ID')
  .action(async (opts: { donor: string; subject: string; relationship: string; verifiedBy: string }) => {
    if (!['parent', 'grandparent', 'other'].includes(opts.relationship)) {
      console.error('--relationship must be one of: parent, grandparent, other');
      process.exitCode = 1;
      return;
    }
    const link = await linkDonorToSubject(opts.donor, opts.subject, opts.relationship as 'parent' | 'grandparent' | 'other', opts.verifiedBy);
    console.log(`Donor ${link.donorId} linked to subject ${link.subjectId} (${link.relationship}, verified by ${link.verifiedBy})`);
  });

export const subjectConsentCommand = new Command('subject:consent')
  .description('Record that photo consent is on file for a subject')
  .requiredOption('--subject <id>', 'Subject UUID')
  .action(async (opts: { subject: string }) => {
    await confirmPhotoConsent(opts.subject);
    console.log(`photo_consent_on_file=true set on subject ${opts.subject}`);
  });
