export type ChannelKind = 'whatsapp' | 'sms' | 'email';

export interface TemplateRecord {
  id: string;
  orgId: string;
  channel: ChannelKind;
  key: string;
  version: string;
  body: string;          // with {{variable}} slots
  variables: string[];
  hasMediaHeader: boolean;
  metaTemplateName: string | null;
  metaStatus: string | null;
}

export interface MediaRef {
  uri: string;     // publicly reachable URL
  mimeType: string; // 'image/jpeg' | 'image/png' | 'video/mp4'
}

export interface SendRequest {
  touchId: string;
  donorId: string;
  channel: ChannelKind;
  to: string;                        // E.164 phone or email address
  template: TemplateRecord;
  variables: Record<string, string>;
  media?: MediaRef;                  // WhatsApp header only
}

export interface RenderedPayload {
  provider: 'zernio' | 'emailit';
  endpoint: string;
  body: unknown;
}

export interface DryRunResult {
  dryRun: true;
  rendered: RenderedPayload;
}

export interface LiveResult {
  dryRun: false;
  providerMessageId: string;
  rendered: RenderedPayload;
}

export type SendResult = DryRunResult | LiveResult;
