import {MagnetLinkInterface} from './types/MagnetLink';

// Base32 alphabet (RFC 4648)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToHex(base32: string): string {
  const cleaned = base32.toUpperCase().replace(/=+$/, '');

  let bits = '';
  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);

    if (val === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    bits += val.toString(2).padStart(5, '0');
  }

  // Convert bits to hex (take only the first 160 bits for a 20-byte hash)
  let hex = '';
  for (let i = 0; i + 4 <= bits.length && hex.length < 40; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return hex;
}

export function parseMagnetUri(uri: string): MagnetLinkInterface {
  if (!uri.startsWith('magnet:?')) {
    throw new Error('Invalid magnet URI: must start with "magnet:?"');
  }

  const queryString = uri.slice('magnet:?'.length);
  const params = new URLSearchParams(queryString);

  const xt = params.get('xt');
  if (!xt || !xt.startsWith('urn:btih:')) {
    throw new Error('Invalid magnet URI: missing or invalid "xt" parameter');
  }

  const rawHash = xt.slice('urn:btih:'.length);
  let infoHash: string;

  if (rawHash.length === 40 && /^[0-9a-fA-F]{40}$/.test(rawHash)) {
    infoHash = rawHash.toLowerCase();
  } else if (rawHash.length === 32) {
    infoHash = base32ToHex(rawHash).toLowerCase();

    if (infoHash.length !== 40) {
      throw new Error(
        'Invalid magnet URI: Base32 info hash did not produce 40 hex characters'
      );
    }
  } else {
    throw new Error(
      `Invalid magnet URI: info hash must be 40 hex chars or 32 Base32 chars, got ${rawHash.length} chars`
    );
  }

  const displayName = params.get('dn') || undefined;

  const trackers = params.getAll('tr');

  return {infoHash, displayName, trackers};
}

export default parseMagnetUri;
