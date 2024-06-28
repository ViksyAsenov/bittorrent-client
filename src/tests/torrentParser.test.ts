import TorrentParser from '../torrentParser';
import Torrent from '../types/Torrent';

describe('TorrentParser', () => {
  const torrent: Torrent = TorrentParser.open('sample.torrent');

  test('should have correct announce URL', () => {
    expect(torrent.announce).toBe('http://the-boys.torrent');
  });

  test('should have correct info_hash', () => {
    expect(TorrentParser.getInfoHash(torrent)).toBe(
      '096fa75040cf03af7633fae4856f26d96ddaf198'
    );
  });

  test('should have correct size as number', () => {
    expect(TorrentParser.getSizeToNumber(torrent)).toBe(4347345636);
  });

  test('should have correct size as buffer', () => {
    expect(TorrentParser.getSizeToBuffer(torrent)).toEqual(
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x03, 0x1f, 0x3a, 0xe4])
    );
  });
});
