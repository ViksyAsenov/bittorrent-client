import net from 'net';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import Downloader from '../download';
import MessageHandler from '../message';
import TorrentInterface from '../types/Torrent';
import TrackerBuilder from '../tracker';

const buildSyntheticTorrent = (
  content: Buffer,
  pieceLength: number
): TorrentInterface => {
  const numPieces = Math.ceil(content.length / pieceLength);
  const pieceHashes: Buffer[] = [];

  for (let i = 0; i < numPieces; i++) {
    const start = i * pieceLength;
    const end = Math.min(start + pieceLength, content.length);

    const hash = crypto
      .createHash('sha1')
      .update(content.slice(start, end))
      .digest();

    pieceHashes.push(hash);
  }

  return {
    announce: 'http://mock-tracker:6969/announce',
    info: {
      name: 'test-download-output',
      'piece length': pieceLength,
      pieces: Buffer.concat(pieceHashes),
      length: content.length,
    },
  };
};

const startMockPeer = (
  content: Buffer,
  torrent: TorrentInterface,
  onListening: (port: number) => void,
  options?: {maxPieces?: number}
): net.Server => {
  const server = net.createServer(socket => {
    let handshakeDone = false;
    let savedBuffer = Buffer.alloc(0);
    let piecesSent = 0;

    socket.on('data', data => {
      savedBuffer = Buffer.concat([savedBuffer, data]);

      if (!handshakeDone) {
        if (savedBuffer.length >= 68) {
          const response = Buffer.alloc(68);
          response.writeUInt8(19, 0);
          response.write('BitTorrent protocol', 1);
          response.writeUInt32BE(0, 20);
          response.writeUInt32BE(0, 24);

          savedBuffer.copy(response, 28, 28, 48);

          Buffer.from('-MK0001-123456789012').copy(response, 48);
          socket.write(response);

          savedBuffer = savedBuffer.slice(68);
          handshakeDone = true;

          const numPieces = torrent.info.pieces.length / 20;
          const bitfieldLength = Math.ceil(numPieces / 8);
          const bitfield = Buffer.alloc(bitfieldLength, 0xff);

          const spareBits = bitfieldLength * 8 - numPieces;
          if (spareBits > 0) {
            bitfield[bitfieldLength - 1] &= 0xff << spareBits;
          }
          socket.write(MessageHandler.buildBitfield(bitfield));

          socket.write(MessageHandler.buildUnchoke());
        }

        return;
      }

      while (savedBuffer.length >= 4) {
        const msgLen = savedBuffer.readInt32BE(0);

        if (msgLen === 0) {
          savedBuffer = savedBuffer.slice(4);
          continue;
        }

        if (savedBuffer.length < 4 + msgLen) break;

        const msgId = savedBuffer.readUInt8(4);
        const payload = savedBuffer.slice(5, 4 + msgLen);
        savedBuffer = savedBuffer.slice(4 + msgLen);

        if (msgId === 6 && payload.length >= 12) {
          // If maxPieces is set and we've sent enough, kill the connection
          if (options?.maxPieces && piecesSent >= options.maxPieces) {
            socket.destroy();
            return;
          }

          const pieceIndex = payload.readUInt32BE(0);
          const begin = payload.readUInt32BE(4);
          const length = payload.readUInt32BE(8);

          const offset = pieceIndex * torrent.info['piece length'] + begin;
          const block = content.slice(offset, offset + length);

          socket.write(
            MessageHandler.buildPiece({
              index: pieceIndex,
              begin: begin,
              block: block,
            })
          );

          piecesSent++;
        }
      }
    });

    socket.on('error', () => {});
  });

  server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as net.AddressInfo;
    onListening(addr.port);
  });

  return server;
}

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'test-output');

beforeAll(() => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  }
  
  jest.spyOn(console, 'log').mockImplementation(() => {})
});

afterAll(() => {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, {recursive: true, force: true});
  }
  
  jest.restoreAllMocks()
});


const originalExit = process.exit;
beforeEach(() => {
  process.exit = jest.fn() as never;
});

afterEach(() => {
  process.exit = originalExit;
});

const runDownloadTest = (
  testName: string,
  contentSize: number,
  pieceLength: number
) => {
  const timeoutMs = 20000;

  test(
    testName,
    done => {
      const content = crypto.randomBytes(contentSize);
      const torrent = buildSyntheticTorrent(content, pieceLength);

      const outputPath = path.join(
        OUTPUT_DIR,
        `${testName.replace(/\s+/g, '_')}.bin`
      );

      // eslint-disable-next-line prefer-const
      let safetyTimeout: ReturnType<typeof setTimeout>;
      let downloader: Downloader;

      process.exit = jest.fn((() => {
        clearTimeout(safetyTimeout);
        
        const downloaded = fs.readFileSync(outputPath);
        expect(downloaded.length).toBe(content.length);
        expect(downloaded.equals(content)).toBe(true);

        server.close();

        done();
      }) as never);

      const originalBuildTracker = TrackerBuilder.buildTracker;
      // eslint-disable-next-line prefer-const
      let server: net.Server;

      server = startMockPeer(content, torrent, port => {
        TrackerBuilder.buildTracker = jest.fn().mockReturnValue({
          getPeers: (
            callback: (peers: {ip: string; port: number}[]) => void
          ) => {
            callback([{ip: '127.0.0.1', port}]);
          },
        });

        downloader = new Downloader(torrent, outputPath);
        downloader.download();
      });

      safetyTimeout = setTimeout(() => {
        TrackerBuilder.buildTracker = originalBuildTracker;
        server.close();
        done(
          new Error(
            `Test timed out — download did not complete within ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
    },
    timeoutMs + 5000
  );
}

describe('Download Integration (simulated peer)', () => {
  runDownloadTest('evenly divisible pieces', 65536, 16384);

  runDownloadTest('non-divisible last piece', 80000, 16384);

  runDownloadTest('single small piece', 10000, 16384);

  runDownloadTest('multi-block pieces', 131072, 65536);
});

describe('Download reannounce on peer disconnect', () => {
  test('reannounces and completes after all peers disconnect', done => {
    const contentSize = 65536;
    const pieceLength = 16384;

    const content = crypto.randomBytes(contentSize);
    const torrent = buildSyntheticTorrent(content, pieceLength);
    const numPieces = Math.ceil(contentSize / pieceLength);
    const outputPath = path.join(OUTPUT_DIR, 'reannounce_test.bin');

    // eslint-disable-next-line prefer-const
    let safetyTimeout: ReturnType<typeof setTimeout>;
    // eslint-disable-next-line prefer-const
    let server1: net.Server;
    let server2: net.Server | null = null;
    let getPeersCallCount = 0;

    process.exit = jest.fn((() => {
      clearTimeout(safetyTimeout);

      const downloaded = fs.readFileSync(outputPath);

      expect(downloaded.length).toBe(content.length);
      expect(downloaded.equals(content)).toBe(true);

      server1.close();
      if (server2) server2.close();

      done();
    }) as never);

    // Peer 1: only serves half the pieces then kills the socket
    const halfPieces = Math.floor(numPieces / 2);
    server1 = startMockPeer(
      content,
      torrent,
      port1 => {
        // Start peer 2 (serves everything) on a different port
        server2 = startMockPeer(content, torrent, port2 => {
          TrackerBuilder.buildTracker = jest.fn().mockReturnValue({
            getPeers: (
              callback: (peers: {ip: string; port: number}[]) => void
            ) => {
              getPeersCallCount++;
              if (getPeersCallCount === 1) {
                // First call: return peer 1 only
                callback([{ip: '127.0.0.1', port: port1}]);
              } else {
                // Reannounce: return peer 2
                callback([{ip: '127.0.0.1', port: port2}]);
              }
            },
          });

          const downloader = new Downloader(torrent, outputPath);
          downloader.download();
        });
      },
      {maxPieces: halfPieces}
    );

    safetyTimeout = setTimeout(() => {
      server1.close();
      if (server2) server2.close();
      done(
        new Error(
          'Test timed out — download did not complete after reannounce'
        )
      );
    }, 20000);
  }, 25000);
});
