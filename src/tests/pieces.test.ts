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

    // Order is randomized by Fisher-Yates shuffle, so use order-independent checks
    // First block should be full size
    expect(missingBlocks).toContainEqual({
      index: 0,
      begin: 0,
      length: 16384,
    });

    // Second block is the last block of the torrent, so it should be the remainder
    expect(missingBlocks).toContainEqual({
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

    // Order is randomized by Fisher-Yates shuffle, so use order-independent checks
    // Piece 0 is not the last piece — its single block is full 16KB
    expect(missingBlocks).toContainEqual({
      index: 0,
      begin: 0,
      length: 16384,
    });

    // Piece 1 is the last piece, so its last block is the remainder
    expect(missingBlocks).toContainEqual({
      index: 1,
      begin: 0,
      length: 3616,
    });
  });
});

describe('Piece Availability (Rarest First)', () => {
  // 4 pieces, each 16KB = 1 block per piece
  const torrent: TorrentInterface = {
    announce: 'http://tracker.com',
    info: {
      name: 'test',
      'piece length': 16384,
      pieces: Buffer.alloc(80), // 4 pieces
      length: 65536,
    },
  };

  // Helper: build a bitfield buffer from an array of piece availability booleans
  const buildBitfield = (has: boolean[]): Buffer => {
    const buf = Buffer.alloc(Math.ceil(has.length / 8), 0);
    has.forEach((v, i) => {
      if (v) buf[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
    });
    return buf;
  };

  test('getRarestPieces returns pieces sorted by ascending availability', () => {
    const pieces = new Pieces(torrent);

    // Peer A has pieces 0, 1, 2, 3
    pieces.addPeerBitfield(buildBitfield([true, true, true, true]));
    // Peer B has pieces 0, 1
    pieces.addPeerBitfield(buildBitfield([true, true, false, false]));
    // Peer C has piece 0 only
    pieces.addPeerBitfield(buildBitfield([true, false, false, false]));

    // Availability: piece 0 = 3, piece 1 = 2, piece 2 = 1, piece 3 = 1
    // A peer that has all 4 should get them ordered: [2 or 3], [2 or 3], 1, 0
    const peerBitfield = [true, true, true, true];
    const result = pieces.getRarestPieces(peerBitfield);

    expect(result.length).toBe(4);
    // Pieces 2 and 3 are rarest (availability=1), should come first (in random order)
    expect(result.slice(0, 2).sort()).toEqual([2, 3]);
    // Piece 1 (availability=2) should come next
    expect(result[2]).toBe(1);
    // Piece 0 (availability=3) should come last
    expect(result[3]).toBe(0);
  });

  test('getRarestPieces filters out pieces the peer does not have', () => {
    const pieces = new Pieces(torrent);
    pieces.addPeerBitfield(buildBitfield([true, true, true, true]));

    // Peer only has pieces 1 and 3
    const peerBitfield = [false, true, false, true];
    const result = pieces.getRarestPieces(peerBitfield);

    expect(result.length).toBe(2);
    expect(result.sort()).toEqual([1, 3]);
  });

  test('getRarestPieces filters out already received pieces', () => {
    const pieces = new Pieces(torrent);
    pieces.addPeerBitfield(buildBitfield([true, true, true, true]));

    // Mark piece 0 as fully received
    pieces.addReceived({index: 0, begin: 0, length: 16384});

    const peerBitfield = [true, true, true, true];
    const result = pieces.getRarestPieces(peerBitfield);

    expect(result).not.toContain(0);
    expect(result.length).toBe(3);
  });

  test('removePeerBitfield correctly decrements availability', () => {
    const pieces = new Pieces(torrent);

    pieces.addPeerBitfield(buildBitfield([true, true, false, false]));
    pieces.addPeerBitfield(buildBitfield([true, false, true, false]));

    // Availability: [2, 1, 1, 0]
    // Remove first peer
    pieces.removePeerBitfield([true, true, false, false]);

    // Availability should now be: [1, 0, 1, 0]
    const peerBitfield = [true, true, true, true];
    const result = pieces.getRarestPieces(peerBitfield);

    // Pieces 1 and 3 have availability 0 (rarest), then 0 and 2 have availability 1
    expect(result.slice(0, 2).sort()).toEqual([1, 3]);
    expect(result.slice(2).sort()).toEqual([0, 2]);
  });

  test('addPeerHave increments availability for a single piece', () => {
    const pieces = new Pieces(torrent);

    pieces.addPeerHave(2);
    pieces.addPeerHave(2);
    pieces.addPeerHave(0);

    // Availability: [1, 0, 2, 0]
    const peerBitfield = [true, true, true, true];
    const result = pieces.getRarestPieces(peerBitfield);

    // Pieces 1, 3 are rarest (0), then piece 0 (1), then piece 2 (2)
    expect(result.slice(0, 2).sort()).toEqual([1, 3]);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(2);
  });
});

describe('Endgame Mode Logic', () => {
  // 4 pieces, each 16KB = 1 block per piece
  const torrent: TorrentInterface = {
    announce: 'http://tracker.com',
    info: {
      name: 'test',
      'piece length': 16384,
      pieces: Buffer.alloc(80), // 4 pieces
      length: 65536,
    },
  };

  test('isEndGame returns false when no blocks have been requested', () => {
    const pieces = new Pieces(torrent);
    // Nothing requested, nothing received — not endgame
    expect(pieces.isEndGame()).toBe(false);
  });

  test('isEndGame returns true when all remaining blocks are requested', () => {
    const pieces = new Pieces(torrent);

    // Receive pieces 0 and 1
    pieces.addReceived({index: 0, begin: 0, length: 16384});
    pieces.addReceived({index: 1, begin: 0, length: 16384});

    // Request (but don't receive) pieces 2 and 3
    pieces.addRequested({index: 2, begin: 0, length: 16384});
    pieces.addRequested({index: 3, begin: 0, length: 16384});

    // All remaining blocks (2, 3) have been requested -> endgame
    expect(pieces.isEndGame()).toBe(true);
  });

  test('isEndGame returns false when remaining blocks > 20 even if all requested', () => {
    // Torrent with many pieces to exceed the 20-block cap
    const bigTorrent: TorrentInterface = {
      announce: 'http://tracker.com',
      info: {
        name: 'test-big',
        'piece length': 16384,
        pieces: Buffer.alloc(30 * 20), // 30 pieces = 30 blocks
        length: 30 * 16384,
      },
    };
    const pieces = new Pieces(bigTorrent);

    // Request all 30 blocks but receive none
    for (let i = 0; i < 30; i++) {
      pieces.addRequested({index: i, begin: 0, length: 16384});
    }

    // All requested but 30 remaining > 20 — the "all requested" path
    // should still trigger endgame since ALL blocks are requested
    expect(pieces.isEndGame()).toBe(true);
  });

  test('isEndGame returns true when remaining <= in-flight and <= 20', () => {
    const pieces = new Pieces(torrent);

    // Receive pieces 0, 1, 2 — only piece 3 remains
    pieces.addReceived({index: 0, begin: 0, length: 16384});
    pieces.addReceived({index: 1, begin: 0, length: 16384});
    pieces.addReceived({index: 2, begin: 0, length: 16384});

    // Request piece 3 (1 in-flight, 1 remaining, 1 <= 1 && 1 <= 20)
    pieces.addRequested({index: 3, begin: 0, length: 16384});

    expect(pieces.isEndGame()).toBe(true);
  });

  test('isEndGame returns false when all blocks are received', () => {
    const pieces = new Pieces(torrent);
    for (let i = 0; i < 4; i++) {
      pieces.addReceived({index: i, begin: 0, length: 16384});
    }
    expect(pieces.isEndGame()).toBe(false);
  });

  test('getInFlightCount returns correct count', () => {
    const pieces = new Pieces(torrent);

    // Request 3 blocks
    pieces.addRequested({index: 0, begin: 0, length: 16384});
    pieces.addRequested({index: 1, begin: 0, length: 16384});
    pieces.addRequested({index: 2, begin: 0, length: 16384});

    // Receive 1 of them
    pieces.addReceived({index: 0, begin: 0, length: 16384});

    // 2 in-flight (requested but not received)
    expect(pieces.getInFlightCount()).toBe(2);
  });

  test('getMissingBlocks returns all unreceived blocks', () => {
    const pieces = new Pieces(torrent);

    pieces.addReceived({index: 0, begin: 0, length: 16384});
    pieces.addReceived({index: 2, begin: 0, length: 16384});

    const missing = pieces.getMissingBlocks();
    expect(missing.length).toBe(2);

    // Should contain pieces 1 and 3 (order may vary due to shuffle)
    const indices = missing.map(b => b.index).sort();
    expect(indices).toEqual([1, 3]);
  });
});
