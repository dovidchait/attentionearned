export type ChannelName = 'whatsapp' | 'sms' | 'email';

export interface SendParams {
  touchId: string;
  donorId: string;
  orgId: string;
  channel: ChannelName;
  templateBody: string;
  variables: Record<string, string>;
  metaTemplateName?: string;       // WhatsApp only — Meta-approved template name
  mediaRenditionUri?: string;      // media header for WhatsApp/email
  recipientPhone?: string;         // E.164
  recipientEmail?: string;
  zernioProfileId?: string;
  zernioPhoneNumberId?: string;
  emailitSenderDomain?: string;
}

export interface SendResult {
  providerMessageId: string;       // real ID or 'dry-run-{uuid}'
  dryRun: boolean;
}

export interface ChannelAdapter {
  send(params: SendParams): Promise<SendResult>;
}
