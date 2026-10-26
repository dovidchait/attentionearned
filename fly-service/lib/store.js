import fs from 'fs';
import path from 'path';

// ============================================================================
// SMALL PERSISTENT STATE (JSON file)
// - lastInbound: when each WhatsApp/SMS/email address last wrote to us
//   (WhatsApp's 24-hour rule for free-form replies)
// - optOut: who replied STOP, per channel
// File: $STATE_FILE, else $STATE_DIR/state.json, else /data/state.json when a
// Fly volume is mounted at /data, else ./data/state.json. Without a volume the
// file lives until the next deploy/restart (see README "Keep opt-outs").
// ============================================================================

let state = null;
let loadedFrom = null;

function stateFile() {
  if (process.env.STATE_FILE) return process.env.STATE_FILE;
  const dir = process.env.STATE_DIR || (fs.existsSync('/data') ? '/data' : path.join(process.cwd(), 'data'));
  return path.join(dir, 'state.json');
}

function load() {
  const file = stateFile();
  if (state && loadedFrom === file) return state;
  loadedFrom = file;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    state = {};
  }
  state.lastInbound ||= {};
  state.optOut ||= {};
  return state;
}

function save() {
  const file = stateFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  } catch (error) {
    console.error(`❌ Could not save state to ${file}:`, error.message);
  }
}

export function normalizeAddress(channel, address) {
  const value = String(address || '').trim();
  if (channel === 'email') {
    const match = value.match(/<([^>]+)>/);
    return (match ? match[1] : value).toLowerCase().trim();
  }
  return value.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
}

function key(channel, address) {
  return `${channel}:${normalizeAddress(channel, address)}`;
}

export function recordInbound(channel, address, at = Date.now()) {
  load().lastInbound[key(channel, address)] = at;
  save();
}

export function lastInbound(channel, address) {
  return load().lastInbound[key(channel, address)] || 0;
}

export function setOptedOut(channel, address, optedOut) {
  const s = load();
  if (optedOut) s.optOut[key(channel, address)] = new Date().toISOString();
  else delete s.optOut[key(channel, address)];
  save();
}

export function isOptedOut(channel, address) {
  return Boolean(load().optOut[key(channel, address)]);
}

/** Tests only: forget the in-memory copy so the next call re-reads the file. */
export function _resetForTests() {
  state = null;
  loadedFrom = null;
}
