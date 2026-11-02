import { channels, smsEnabled } from './channels.js';
import { findUser } from './users.js';
import * as store from './store.js';
import { BRAND, brand } from './brand.js';

export { BRAND, brand };

// ============================================================================
// NOTIFY: every outbound message goes through here.
// - prefixes "Attention Earned:" (matches the toll-free verification samples)
// - never messages anyone who replied STOP on that channel
// - WhatsApp 24-hour rule: free-form only within 24 h of the person's last
//   message. Outside it: live links go out as the approved template
//   (TWILIO_WA_TEMPLATE_POSTED_SID); anything else (failures, or no template)
//   falls back to email, then SMS only if SMS_ENABLED=true.
// - email posts: email delivery is unreliable, so when SMS_ENABLED=true and
//   the sender's users.json entry has a phone, the same result (posted /
//   scheduled / failed) also goes out by SMS.
// ============================================================================

export const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MS = 10 * 60 * 1000; // treat the last 10 minutes of the window as closed

/** Last time this WhatsApp number wrote in: the state file or the time saved on the post. */
export function lastWhatsAppInbound(route) {
  return Math.max(store.lastInbound('whatsapp', route.to) || 0, Number(route.lastInboundAt) || 0);
}

export function insideWhatsAppWindow(route, now = Date.now()) {
  const last = lastWhatsAppInbound(route);
  return last > 0 && now - last < WINDOW_MS - SAFETY_MS;
}

// WhatsApp template variables can't hold newlines, tabs or 4+ spaces in a row.
function templateVar(value, max = 200) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) || '-';
}

async function sendOn(route, text) {
  const channel = channels[route.channel];
  if (!channel) throw new Error(`Unknown reply channel: ${route.channel}`);
  await channel.send(route, brand(text));
  return { sent: true, via: route.channel };
}

/**
 * message: a string, or { text, links: [{ label, url }], title, complete }
 *   complete=true means the links say everything (no failures / pending), so
 *   a template alone is enough outside the WhatsApp window.
 * Returns { sent, via, reason }.
 */
export async function notify(route, message) {
  const msg = typeof message === 'string' ? { text: message } : (message || {});
  if (!route?.channel || !route.to) throw new Error('No reply route');
  if (!msg.text) return { sent: false, reason: 'empty' };

  if (route.channel === 'email') return notifyEmail(route, msg);

  if (store.isOptedOut(route.channel, route.to)) {
    console.log(`🔕 ${route.to} opted out of ${route.channel}; not sending`);
    return { sent: false, reason: 'opted_out' };
  }

  if (route.channel === 'whatsapp' && !insideWhatsAppWindow(route)) {
    return notifyOutsideWindow(route, msg);
  }
  return sendOn(route, msg.text);
}

// Email answer + an SMS copy to the same person (when SMS is on and they have a phone).
// The SMS still goes out if the email send fails.
async function notifyEmail(route, msg) {
  const via = [];
  let emailError = null;
  if (store.isOptedOut('email', route.to)) {
    console.log(`🔕 ${route.to} opted out of email; not sending`);
  } else {
    try {
      await sendOn(route, msg.text);
      via.push('email');
    } catch (error) {
      emailError = error;
      console.error(`❌ Email reply to ${route.to} failed:`, error.message);
    }
  }
  if (await smsCopyForEmail(route.to, msg.text)) via.push('sms');
  if (via.length > 0) return { sent: true, via: via.join('+') };
  if (emailError) throw emailError;
  return { sent: false, reason: 'opted_out' };
}

async function smsCopyForEmail(address, text) {
  if (!smsEnabled()) return false;
  const user = findUser('email', address);
  if (!user?.phone) return false;
  if (store.isOptedOut('sms', user.phone)) {
    console.log(`🔕 ${user.phone} opted out of SMS; no SMS copy of the email reply`);
    return false;
  }
  try {
    await sendOn({ channel: 'sms', to: user.phone }, text);
    console.log(`📱 SMS copy of the email reply sent to ${user.phone}`);
    return true;
  } catch (error) {
    console.error(`❌ SMS copy of the email reply to ${user.phone} failed:`, error.message);
    return false;
  }
}

async function notifyOutsideWindow(route, msg) {
  const contentSid = process.env.TWILIO_WA_TEMPLATE_POSTED_SID;
  const links = (msg.links || []).filter(l => l && l.url);
  const via = [];

  if (contentSid && links.length > 0) {
    for (const link of links) {
      const what = msg.title ? `"${msg.title}" on ${link.label}` : `on ${link.label}`;
      await channels.whatsapp.sendTemplate(route, contentSid, { 1: templateVar(what), 2: templateVar(link.url, 500) });
    }
    via.push('whatsapp-template');
    if (msg.complete) {
      console.log(`📨 WhatsApp window closed for ${route.to}: sent ${links.length} template message(s)`);
      return { sent: true, via: via.join('+') };
    }
  }

  const reason = !contentSid ? 'TWILIO_WA_TEMPLATE_POSTED_SID is not set'
    : links.length === 0 ? 'no live link to put in the template' : 'the template cannot carry failures';
  console.warn(`⚠️  WhatsApp 24h window closed for ${route.to} (${reason}); falling back`);

  const user = findUser('whatsapp', route.to);
  if (user?.email && !store.isOptedOut('email', user.email)) {
    try {
      await sendOn({ channel: 'email', to: user.email }, msg.text);
      console.log(`📧 Fallback to email ${user.email}`);
      return { sent: true, via: [...via, 'email'].join('+') };
    } catch (error) {
      console.error(`❌ Email fallback failed for ${user.email}:`, error.message);
    }
  }
  if (smsEnabled() && user?.phone && !store.isOptedOut('sms', user.phone)) {
    try {
      await sendOn({ channel: 'sms', to: user.phone }, msg.text);
      console.log(`📱 Fallback to SMS ${user.phone}`);
      return { sent: true, via: [...via, 'sms'].join('+') };
    } catch (error) {
      console.error(`❌ SMS fallback failed for ${user.phone}:`, error.message);
    }
  }
  if (via.length > 0) return { sent: true, via: via.join('+'), reason: 'details not delivered: no fallback channel' };
  console.error(`❌ Nothing sent to ${route.to}: WhatsApp window closed and no fallback channel worked`);
  return { sent: false, reason: 'window_closed_no_fallback' };
}
