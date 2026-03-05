import TorrentInterface from './types/Torrent';
import TrackerBuilder from './tracker';
import {PeerInterface} from './types/TrackerResponse';
import MessageHandler from './message';
import MessagePayloadInterface from './types/MessagePayload';
import net, {Socket} from 'net';
import Pieces from './pieces';
import Queue from './queue';
import * as fs from 'fs';
import path from 'path';
import isMultiFileInfo from './utils/isMultiFileInfo';
import logger from './logger';
import TorrentParser from './torrentParser';

const MAX_PIPELINE = 50;

class Downloader {
  private pieces: Pieces;
  private torrent: TorrentInterface;
  private peers: {
    socket: Socket;
    queue: Queue;
    pending: number;
    bitfield: Set<number>;
  }[];
  private path: string;
  private files: {path: string; length: number; offset: number; fd: number}[] =
    [];
  private tracker: {
    getPeers: (callback: (peers: PeerInterface[]) => void) => void;
  } | null = null;
  private reannounceTimer: ReturnType<typeof setInterval> | null = null;
  private knownPeerKeys: Set<string> = new Set();
  private pendingWrites = 0;
  private completed = false;
  private staleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(torrent: TorrentInterface, path: string) {
    this.pieces = new Pieces(torrent);
    this.torrent = torrent;
    this.peers = [];
    this.path = path;
    this.setupFiles();
  }

  get piecesTracker(): Pieces {
    return this.pieces;
  }

  private setupFiles() {
    const info = this.torrent.info;

    if (isMultiFileInfo(info)) {
      let offset = 0;

      for (const file of info.files) {
        const filePath = path.join(this.path, ...file.path);
        fs.mkdirSync(path.dirname(filePath), {recursive: true});

        const fd = fs.openSync(filePath, 'w');
        this.files.push({path: filePath, length: file.length, offset, fd});

        offset += file.length;
      }
    } else {
      const filePath = this.path;
      const fd = fs.openSync(filePath, 'w');

      this.files.push({path: filePath, length: info.length, offset: 0, fd});
    }
  }

  download() {
    this.tracker = TrackerBuilder.buildTracker(this.torrent);

    const totalSize = TorrentParser.getSizeToNumber(this.torrent);
    logger.startDownload(totalSize);

    this.tracker.getPeers((peers: PeerInterface[]) => {
      peers.forEach(peer => this.connectToPeerAndDownload(peer));
    });

    this.reannounceTimer = setInterval(() => {
      if (!this.pieces.isDone() && this.peers.length < 5) {
        this.reannounce();
      }
    }, 30 * 1000);

    // Global stale-request cleanup: reset requested state and
    // re-trigger all peers periodically to unstick the download.
    this.staleTimer = setInterval(() => {
      if (!this.pieces.isDone()) {
        const isEndGame = this.pieces.isEndGame();
        if (isEndGame) {
          // In endgame, we only want to trigger re-requests if we are stalled
          this.peers.forEach(p => {
            if (p.pending === 0) {
              this.requestPiece(p);
            }
          });
        } else {
          this.pieces.resetRequested();
          this.peers.forEach(p => {
            p.pending = 0;
            this.requestPiece(p);
          });
        }
      }
    }, 15 * 1000); // Slightly more frequent cleanup
  }

  private reannounce() {
    if (!this.tracker || this.pieces.isDone()) return;

    logger.info(
      `Reannouncing to tracker (${this.peers.length} peers connected)...`
    );

    this.tracker.getPeers((peers: PeerInterface[]) => {
      for (const peer of peers) {
        const key = `${peer.ip}:${peer.port}`;
        if (!this.knownPeerKeys.has(key)) {
          this.connectToPeerAndDownload(peer);
        }
      }
    });
  }

  private connectToPeerAndDownload(peer: PeerInterface) {
    const peerKey = `${peer.ip}:${peer.port}`;
    if (this.knownPeerKeys.has(peerKey)) return;
    this.knownPeerKeys.add(peerKey);

    const socket = net.createConnection(peer.port, peer.ip, () => {
      socket.write(MessageHandler.buildHandshake(this.torrent));
    });

    const queue = new Queue(this.torrent);
    const peerState = {socket, queue, pending: 0, bitfield: new Set<number>()};
    this.peers.push(peerState);

    const keepAliveInterval = setInterval(() => {
      socket.write(MessageHandler.buildKeepAlive());
    }, 30 * 1000);

    this.onWholeMessage(socket, (message: Buffer) => {
      if (MessageHandler.isHandshake(message, this.torrent)) {
        socket.write(MessageHandler.buildInterested());

        // Send bitfield message after the handshake
        const bitfield = this.pieces.getBitfield();
        if (bitfield.length > 0) {
          socket.write(MessageHandler.buildBitfield(bitfield));
        }
      } else {
        const parsedMessage = MessageHandler.parseMessage(message);

        if (parsedMessage['error']) {
          logger.error(`Protocol error from peer: ${parsedMessage['error']}`);
          socket.destroy();
          return;
        }

        switch (parsedMessage.id) {
          case 0:
            this.handleChoke(peerState);
            break;
          case 1:
            this.handleUnchoke(peerState);
            break;
          case 4:
            this.handleHave(parsedMessage.payload as Buffer, peerState);
            break;
          case 5:
            this.handleBitfield(parsedMessage.payload as Buffer, peerState);
            break;
          case 6:
            this.handleRequest(
              parsedMessage.payload as MessagePayloadInterface,
              socket
            );
            break;
          case 7:
            this.handlePiece(
              parsedMessage.payload as MessagePayloadInterface,
              peerState
            );

            break;
        }
      }
    });

    socket.on('error', (error: Error) => {
      // Don't log spammy socket errors after completion
      if (this.completed) return;
      logger.error(
        `TCP connection error: ${error.message} - ${this.peers.length} peers connected`
      );
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      clearInterval(keepAliveInterval);
      this.peers = this.peers.filter(p => p !== peerState);

      // Trigger other peers to pick up potential gaps
      if (!this.pieces.isDone()) {
        this.peers.forEach(p => this.requestPiece(p));
      }

      // If all peers are gone and download isn't done, reannounce
      if (this.peers.length === 0 && !this.pieces.isDone()) {
        logger.info('All peers disconnected — reannouncing to tracker...');
        this.reannounce();
      }
    };

    socket.on('end', cleanup);
    socket.on('close', cleanup);
    socket.on('timeout', () => socket.destroy());
    socket.setTimeout(60 * 1000); // 60s timeout for inactive peers
  }

  private onWholeMessage(socket: Socket, callback: (buffer: Buffer) => void) {
    let savedBuffer = Buffer.alloc(0);
    let handshake = true;

    socket.on('data', (message: Buffer) => {
      const getMessageLength = () => {
        if (handshake) {
          // Handshake is always 68 bytes
          return 68;
        }
        return savedBuffer.readInt32BE(0) + 4;
      };

      savedBuffer = Buffer.concat([savedBuffer, message]);

      while (savedBuffer.length >= 4) {
        // Sanity check for handshake: first byte must be 19
        if (handshake && savedBuffer[0] !== 19) {
          logger.error('Invalid handshake received (first byte not 19)');
          socket.destroy();
          return;
        }

        const length = getMessageLength();
        if (savedBuffer.length < length) break;

        // Sanity check for message length (max 10MB)
        if (length < 4 || length > 10 * 1024 * 1024) {
          logger.error(`Invalid message length received: ${length}`);
          socket.destroy();
          return;
        }

        callback(savedBuffer.slice(0, length));
        savedBuffer = savedBuffer.slice(length);
        handshake = false;
      }
    });
  }

  private handleChoke(peer: {
    socket: Socket;
    queue: Queue;
    pending: number;
    bitfield: Set<number>;
  }) {
    peer.queue.chocked = true;
  }

  private handleUnchoke(peer: {
    socket: Socket;
    queue: Queue;
    pending: number;
    bitfield: Set<number>;
  }) {
    peer.queue.chocked = false;
    this.requestPiece(peer);
  }

  private handleHave(
    payload: Buffer,
    peer: {socket: Socket; queue: Queue; pending: number; bitfield: Set<number>}
  ) {
    if (!payload || payload.length < 4) {
      logger.error('Malformed HAVE message received');
      return;
    }
    const pieceIndex = payload.readUInt32BE(0);
    if (pieceIndex >= this.pieces.getTotalPieces()) {
      logger.error(`Peer reported HAVE for invalid piece index: ${pieceIndex}`);
      return;
    }
    peer.bitfield.add(pieceIndex);
    peer.queue.add(pieceIndex);
    this.requestPiece(peer);
  }

  private handleBitfield(
    payload: Buffer,
    peer: {socket: Socket; queue: Queue; pending: number; bitfield: Set<number>}
  ) {
    if (!payload) {
      logger.error('Malformed BITFIELD message received');
      return;
    }
    const totalPieces = this.pieces.getTotalPieces();
    payload.forEach((byte, i) => {
      for (let j = 0; j < 8; j++) {
        if (byte % 2) {
          const pieceIndex = i * 8 + 7 - j;
          if (pieceIndex < totalPieces) {
            peer.bitfield.add(pieceIndex);
            peer.queue.add(pieceIndex);
          }
        }
        byte = Math.floor(byte / 2);
      }
    });

    this.requestPiece(peer);
  }

  private handleRequest(payload: MessagePayloadInterface, socket: Socket) {
    const pieceIndex = payload.index;
    const pieceBegin = payload.begin;
    const pieceLength = payload.length as number;
    const offset = pieceIndex * this.torrent.info['piece length'] + pieceBegin;
    const pieceBuffer = Buffer.alloc(pieceLength);

    // Read from the correct file(s) for multi-file torrents
    this.readFromFiles(offset, pieceLength, pieceBuffer, (error, buffer) => {
      if (error) {
        logger.error(`Error reading file(s): ${error.message}`);
        return;
      }
      const pieceMessage = MessageHandler.buildPiece({
        index: pieceIndex,
        begin: pieceBegin,
        block: buffer,
      });
      // Logger.info('Sending piece message'); // This would be too spammy with progress bar
      socket.write(pieceMessage);
    });
  }

  private readFromFiles(
    offset: number,
    length: number,
    buffer: Buffer,
    cb: (error: NodeJS.ErrnoException | null, buffer: Buffer) => void
  ) {
    let remaining = length;
    let bufOffset = 0;
    let fileIdx = this.files.findIndex(
      f => offset >= f.offset && offset < f.offset + f.length
    );

    if (fileIdx === -1) {
      return cb(new Error(`Invalid offset for reading: ${offset}`), buffer);
    }

    let fileOffset = offset - this.files[fileIdx].offset;
    const readNext = () => {
      if (remaining <= 0 || fileIdx >= this.files.length) {
        cb(null, buffer);
        return;
      }
      const file = this.files[fileIdx];
      const toRead = Math.min(remaining, file.length - fileOffset);
      fs.read(
        file.fd,
        buffer,
        bufOffset,
        toRead,
        fileOffset,
        (error, bytesRead) => {
          if (error) {
            return cb(error, buffer);
          }
          remaining -= bytesRead;
          bufOffset += bytesRead;
          fileIdx++;
          fileOffset = 0;
          readNext();
        }
      );
    };
    readNext();
  }

  private handlePiece(
    payload: MessagePayloadInterface,
    peer: {socket: Socket; queue: Queue; pending: number; bitfield: Set<number>}
  ) {
    // Track that we got a response
    peer.pending = Math.max(0, peer.pending - 1);

    // Don't process duplicate blocks
    if (this.pieces.isReceived(payload)) {
      this.requestPiece(peer);
      return;
    }

    this.pieces.addReceived(payload);

    if (payload.block) {
      logger.onBlockReceived((payload.block as Buffer).length);
      logger.printProgress();
    }

    const offset =
      payload.index * this.torrent.info['piece length'] + payload.begin;

    const haveMessage = MessageHandler.buildHave(payload.index);
    this.peers.forEach(p => {
      if (p.socket.writable) {
        p.socket.write(haveMessage);
      }
    });

    const cancelMessage = MessageHandler.buildCancel(payload);
    this.peers.forEach(p => {
      if (p !== peer && p.socket.writable) {
        p.socket.write(cancelMessage);
      }
    });

    this.pendingWrites++;
    this.writeToFiles(offset, payload.block as Buffer, () => {
      this.pendingWrites--;
      if (this.pieces.isDone() && this.pendingWrites === 0) {
        this.onComplete();
      }
    });

    if (!this.pieces.isDone()) {
      if (this.pieces.isEndGame()) {
        // Only trigger all peers if the queue is dangerously low or we just entered endgame
        const totalPending = this.peers.reduce((sum, p) => sum + p.pending, 0);
        if (totalPending < 5) {
          this.peers.forEach(p => this.requestPiece(p));
        } else {
          this.requestPiece(peer);
        }
      } else {
        this.requestPiece(peer);
      }
    }
  }

  private onComplete() {
    if (this.completed) return;
    this.completed = true;

    try {
      if (this.staleTimer) {
        clearInterval(this.staleTimer);
        this.staleTimer = null;
      }
      if (this.reannounceTimer) {
        clearInterval(this.reannounceTimer);
        this.reannounceTimer = null;
      }
      this.peers.forEach(p => {
        p.socket.destroy(); // Use destroy() for immediate cleanup in tests
      });
      this.peers = [];

      this.files.forEach(f => {
        try {
          fs.closeSync(f.fd);
        } catch (e) {
          // Ignore EBADF if already closed
        }
      });
      logger.downloadComplete();

      // eslint-disable-next-line n/no-process-exit
      process.exit(0);
    } catch (error) {
      console.error(error);
    }
  }

  private writeToFiles(offset: number, data: Buffer, cb: () => void) {
    let remaining = data.length;
    let bufOffset = 0;
    let fileIdx = this.files.findIndex(
      f => offset >= f.offset && offset < f.offset + f.length
    );

    if (fileIdx === -1) {
      logger.error(`Invalid offset for writing: ${offset}`);
      return cb();
    }

    let fileOffset = offset - this.files[fileIdx].offset;
    const writeNext = () => {
      if (remaining <= 0 || fileIdx >= this.files.length) {
        cb();
        return;
      }
      const file = this.files[fileIdx];
      const toWrite = Math.min(remaining, file.length - fileOffset);
      fs.write(file.fd, data, bufOffset, toWrite, fileOffset, error => {
        if (error) {
          logger.error(`Error writing to file: ${error.message}`);
        }
        remaining -= toWrite;
        bufOffset += toWrite;
        fileIdx++;
        fileOffset = 0;
        writeNext();
      });
    };
    writeNext();
  }

  private requestPiece(peer: {
    socket: Socket;
    queue: Queue;
    pending: number;
    bitfield: Set<number>;
  }) {
    if (peer.queue.chocked) return;

    // Fill queue with some missing blocks when empty
    if (peer.queue.length() === 0 && !this.pieces.isDone()) {
      const missingBlocks = this.pieces.getMissingBlocks();

      // Filter by what the peer actually has
      const peerMissingBlocks = missingBlocks.filter(b =>
        peer.bitfield.has(b.index)
      );

      // Only take a subset to avoid massive queues and redundant work
      const blocksToEnqueue = peerMissingBlocks.slice(0, MAX_PIPELINE * 2);
      for (const block of blocksToEnqueue) {
        peer.queue.enqueue(block);
      }
    }

    // Bug 2 fix: Send up to MAX_PIPELINE concurrent requests instead of just 1
    while (peer.pending < MAX_PIPELINE && peer.queue.length() > 0) {
      const pieceBlock = peer.queue.poll() as MessagePayloadInterface;

      if (this.pieces.needed(pieceBlock)) {
        if (peer.socket.writable) {
          peer.socket.write(MessageHandler.buildRequest(pieceBlock));
          this.pieces.addRequested(pieceBlock);
          peer.pending++;
        }
      }
    }
  }
}

export default Downloader;
