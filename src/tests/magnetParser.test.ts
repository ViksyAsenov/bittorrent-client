import {parseMagnetUri} from '../magnetParser';

describe('parseMagnetUri', () => {
  test('parses hex info hash', () => {
    const uri =
      'magnet:?xt=urn:btih:aabbccddee11223344556677889900aabbccddee&dn=TestFile&tr=udp://tracker.example.com:6969/announce';

    const result = parseMagnetUri(uri);

    expect(result.infoHash).toBe('aabbccddee11223344556677889900aabbccddee');
    expect(result.displayName).toBe('TestFile');
    expect(result.trackers).toEqual([
      'udp://tracker.example.com:6969/announce',
    ]);
  });

  test('parses uppercase hex info hash to lowercase', () => {
    const uri = 'magnet:?xt=urn:btih:AABBCCDDEE11223344556677889900AABBCCDDEE';

    const result = parseMagnetUri(uri);

    expect(result.infoHash).toBe('aabbccddee11223344556677889900aabbccddee');
  });

  test('parses Base32 info hash', () => {
    // "YNCKHTQOIIV6V3IYXE3I" is not 32 chars. Let's use a proper 32-char base32.
    // 20 bytes = 160 bits => 32 base32 chars
    // Use a known hex "0000000000000000000000000000000000000000" => base32 "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    // Actually let's compute: hex "da39a3ee5e6b4b0d3255bfef95601890afd80709"
    // That's SHA-1 of empty string. Base32: 3I47C3RPNNCBC4SLX7XJLADREMX4AHI5
    // But let's just use a simple one:
    // hex = 0102030405060708091011121314151617181920
    // ... better to just test the function structure

    // Known conversion: base32 "MFRA" = hex "61" ...
    // For a proper 20-byte hash test, let's use all A's:
    // Base32 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA = 0x0000...0000 (but trailing trimming may vary)
    // Let's just test with a real-world hash
    const uri = 'magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    // This is 31 chars + pad which won't work. Use exactly 32 chars:
    const uri2 = 'magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const result = parseMagnetUri(uri2);

    expect(result.infoHash).toBe('0000000000000000000000000000000000000000');
  });

  test('extracts multiple trackers', () => {
    const uri =
      'magnet:?xt=urn:btih:aabbccddee11223344556677889900aabbccddee' +
      '&tr=udp://tracker1.example.com:6969' +
      '&tr=http://tracker2.example.com/announce' +
      '&tr=udp://tracker3.example.com:1337';

    const result = parseMagnetUri(uri);

    expect(result.trackers).toHaveLength(3);
    expect(result.trackers).toContain('udp://tracker1.example.com:6969');
    expect(result.trackers).toContain('http://tracker2.example.com/announce');
    expect(result.trackers).toContain('udp://tracker3.example.com:1337');
  });

  test('handles missing display name', () => {
    const uri = 'magnet:?xt=urn:btih:aabbccddee11223344556677889900aabbccddee';

    const result = parseMagnetUri(uri);

    expect(result.displayName).toBeUndefined();
  });

  test('handles missing trackers', () => {
    const uri =
      'magnet:?xt=urn:btih:aabbccddee11223344556677889900aabbccddee&dn=Test';

    const result = parseMagnetUri(uri);

    expect(result.trackers).toEqual([]);
  });

  test('throws on invalid URI scheme', () => {
    expect(() => parseMagnetUri('http://example.com')).toThrow(
      'Invalid magnet URI'
    );
  });

  test('throws on missing xt parameter', () => {
    expect(() => parseMagnetUri('magnet:?dn=Test')).toThrow(
      'missing or invalid "xt" parameter'
    );
  });

  test('throws on invalid info hash length', () => {
    expect(() => parseMagnetUri('magnet:?xt=urn:btih:tooshort')).toThrow(
      'info hash must be 40 hex chars or 32 Base32 chars'
    );
  });
});
