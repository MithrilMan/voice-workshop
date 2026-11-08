import { VoiceDesign, VOICE_FORMAT, VOICE_V1_BASE, cloneVoice, sanitizeVoice } from './design';

/**
 * A voice as a file and as a link. The file is the voice in readable JSON.
 * The link holds only what differs from the reference voice of its version
 * (frozen, so an old link always means the same voice), compressed
 * (deflate) and in base64url, after `#voice=` in the address: the part after
 * # never leaves the browser, so sharing a voice needs no server. Whatever
 * comes in, from a file or a link, passes through sanitizeVoice.
 */

/** no voice is near this long; anything longer is not one */
const MAX_JSON = 32768;
const LINK_KEY = 'voice=';

export const voiceToJson = (d: VoiceDesign): string => JSON.stringify(d, null, 2);

export function voiceFromJson(text: string): VoiceDesign | null {
  if (text.length > MAX_JSON * 4) return null;
  try { return sanitizeVoice(JSON.parse(text)); } catch { return null; }
}

/** a file name for a voice */
export const voiceFileName = (d: VoiceDesign): string =>
  `${(d.name || 'voice').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'voice'}.voice.json`;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** the leaves of a that differ from b */
function diff(a: Json, b: Json): Json | undefined {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(a)) {
      const d = diff(a[k], b[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? undefined : a;
}

/** b with the leaves of a laid over it */
function overlay(b: Json, a: Json): Json {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: { [k: string]: Json } = { ...b };
    for (const k of Object.keys(a)) if (k in b) out[k] = overlay(b[k], a[k]);
    return out;
  }
  return a;
}

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** runs bytes through a (de)compression stream, giving up past `limit` bytes */
async function pipe(bytes: Uint8Array, ts: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(ts as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const canZip = (): boolean => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** The part of a link after #: `voice=v1.…` */
export async function voiceToLink(d: VoiceDesign): Promise<string> {
  const delta = (diff(d as unknown as Json, VOICE_V1_BASE as unknown as Json) ?? {}) as { [k: string]: Json };
  delete delta.format; delete delta.version;
  delta.id = d.id;
  const bytes = new TextEncoder().encode(JSON.stringify(delta));
  if (canZip()) {
    const z = await pipe(bytes, new CompressionStream('deflate-raw'));
    if (z) return `${LINK_KEY}v1.${b64url(z)}`;
  }
  return `${LINK_KEY}v1u.${b64url(bytes)}`;
}

/** The voice in an address's # part (`#voice=…`, alone or among other parts), or null. */
export async function voiceFromLink(hash: string): Promise<VoiceDesign | null> {
  const part = hash.replace(/^#/, '').split('&').find((p) => p.startsWith(LINK_KEY));
  if (!part) return null;
  const m = /^(v1u?)\.([A-Za-z0-9_-]+)$/.exec(part.slice(LINK_KEY.length));
  if (!m || m[2].length > MAX_JSON) return null;
  try {
    let bytes: Uint8Array | null = unb64url(m[2]);
    if (m[1] === 'v1') bytes = canZip() ? await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON) : null;
    if (!bytes || bytes.length > MAX_JSON) return null;
    const delta = JSON.parse(new TextDecoder().decode(bytes)) as Json;
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return null;
    const whole = overlay(cloneVoice() as unknown as Json, delta) as { [k: string]: Json };
    whole.format = VOICE_FORMAT;
    return sanitizeVoice(whole);
  } catch {
    return null;
  }
}
