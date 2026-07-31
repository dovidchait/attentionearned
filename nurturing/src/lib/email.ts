import { Resend } from 'resend';
import { getPresignedDownloadUrl } from './s3';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL ?? 'photos@attentionearned.com';

interface PhotoNotification {
  parentName: string;
  parentEmail: string;
  childName: string;
  photoKeys: string[];
}

export async function sendPhotoEmail({
  parentName,
  parentEmail,
  childName,
  photoKeys,
}: PhotoNotification) {
  const signedUrls = await Promise.all(
    photoKeys.map((key) => getPresignedDownloadUrl(key, 604800))
  );

  const photoHtml = signedUrls
    .map(
      (url) =>
        `<img src="${url}" alt="Photo of ${childName}" style="max-width:100%;border-radius:8px;margin-bottom:12px;" />`
    )
    .join('\n');

  const count = photoKeys.length;
  const subject = `${count} new photo${count > 1 ? 's' : ''} of ${childName}!`;

  await resend.emails.send({
    from: FROM,
    to: parentEmail,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="margin-bottom:4px;">Hi ${parentName}!</h2>
        <p style="color:#555;margin-top:0;">
          We captured ${count} new photo${count > 1 ? 's' : ''} of ${childName} today.
        </p>
        <div style="margin-top:24px;">
          ${photoHtml}
        </div>
        <p style="color:#999;font-size:12px;margin-top:32px;">
          These photo links are valid for 7 days.
        </p>
      </div>
    `,
  });
}
