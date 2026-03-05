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
      name: 'test-endgame-output',
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
  options?: {slowOnLastBlock?: boolean; skipBlocks?: number[]}
): net.Server => {
  const server = net.createServer(socket => {
    let handshakeDone = false;
    let savedBuffer = Buffer.alloc(0);

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
          const pieceIndex = payload.readUInt32BE(0);
          const begin = payload.readUInt32BE(4);
          const length = payload.readUInt32BE(8);

          const totalBlocks = Math.ceil(content.length / 16384);
          const blockIndex =
            pieceIndex * Math.ceil(torrent.info['piece length'] / 16384) +
            begin / 16384;

          if (options?.skipBlocks?.includes(blockIndex)) {
            // Just ignore the request
            return;
          }

          if (options?.slowOnLastBlock && blockIndex === totalBlocks - 1) {
            // Simulate a VERY slow response or never responding
            return;
          }

          const offset = pieceIndex * torrent.info['piece length'] + begin;
          const block = content.slice(offset, offset + length);

          socket.write(
            MessageHandler.buildPiece({
              index: pieceIndex,
              begin: begin,
              block: block,
            })
          );
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
};

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'test-endgame-output');

beforeAll(() => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  }
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, {recursive: true, force: true});
  }
  jest.restoreAllMocks();
});

const originalExit = process.exit;
beforeEach(() => {
  process.exit = jest.fn() as never;
});

afterEach(() => {
  process.exit = originalExit;
});

describe('Endgame Mode Verification', () => {
  test('completes download when one peer stalls on the last block', done => {
    // 2 pieces, 16KB each. 32KB total.
    const contentSize = 32768;
    const pieceLength = 16384;
    const content = crypto.randomBytes(contentSize);
    const torrent = buildSyntheticTorrent(content, pieceLength);
    const outputPath = path.join(OUTPUT_DIR, 'endgame_test.bin');

    let serverSlow: net.Server;
    let serverFast: net.Server;
    let safetyTimeout: ReturnType<typeof setTimeout>;

    process.exit = jest.fn((() => {
      clearTimeout(safetyTimeout);
      const downloaded = fs.readFileSync(outputPath);
      expect(downloaded.length).toBe(content.length);
      expect(downloaded.equals(content)).toBe(true);
      serverSlow.close();
      serverFast.close();
      done();
    }) as never);

    // Peer 1: Slow/Ignored for the last block
    serverSlow = startMockPeer(
      content,
      torrent,
      portSlow => {
        // Peer 2: Fast, responds to everything
        serverFast = startMockPeer(content, torrent, portFast => {
          TrackerBuilder.buildTracker = jest.fn().mockReturnValue({
            getPeers: (
              callback: (peers: {ip: string; port: number}[]) => void
            ) => {
              // Return both peers
              callback([
                {ip: '127.0.0.1', port: portSlow},
                {ip: '127.0.0.1', port: portFast},
              ]);
            },
          });

          const downloader = new Downloader(torrent, outputPath);
          downloader.download();
        });
      },
      {slowOnLastBlock: true}
    );

    safetyTimeout = setTimeout(() => {
      serverSlow.close();
      serverFast.close();
      done(
        new Error('Test timed out — download did not complete in endgame mode')
      );
    }, 15000);
  }, 20000);
});
