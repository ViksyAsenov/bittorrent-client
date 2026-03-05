import Pieces from '../pieces';
import TorrentInterface from '../types/Torrent';

describe('Pieces', () => {
  const mockTorrent: TorrentInterface = {
    announce: 'http://tracker.com',
    info: {
      name: 'test',
      'piece length': 32768, // 2 blocks of 16KB
      pieces: Buffer.alloc(20), // 1 piece
      length: 20000, // Total length is less than piece length, making the last block shorter
    },
  };

  test('getMissingBlocks should return correct lengths for all blocks (only last block of torrent is tail)', () => {
    const pieces = new Pieces(mockTorrent);
    const missingBlocks = pieces.getMissingBlocks();

    expect(missingBlocks.length).toBe(2);
    
    // First block should be full size
    expect(missingBlocks[0]).toEqual({
      index: 0,
      begin: 0,
      length: 16384,
    });

    // Second block is the last block of the torrent, so it should be the remainder
    expect(missingBlocks[1]).toEqual({
      index: 0,
      begin: 16384,
      length: 3616,
    });
  });

  test('getMissingBlocks should only use custom length for the ABSOLUTE last block', () => {
      const complexMockTorrent: TorrentInterface = {
          announce: 'http://tracker.com',
          info: {
              name: 'test',
              'piece length': 16384, // 1 block per piece
              pieces: Buffer.alloc(40), // 2 pieces
              length: 20000, 
          },
      };

      const pieces = new Pieces(complexMockTorrent);
      const missingBlocks = pieces.getMissingBlocks();

      expect(missingBlocks.length).toBe(2);
      
      // Piece 0 is not the last piece, so its last block (index 0) remains 16KB 
      // even though the piece itself is logically 16KB (this is expected for intermediate pieces)
      expect(missingBlocks[0]).toEqual({
          index: 0,
          begin: 0,
          length: 16384,
      });

      // Piece 1 is the last piece, so its last block is the remainder
      expect(missingBlocks[1]).toEqual({
          index: 1,
          begin: 0,
          length: 3616,
      });
  });
});
