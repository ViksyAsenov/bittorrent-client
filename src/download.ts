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

const MAX_PIPELINE = 10;

class Downloader {
  private pieces: Pieces;
  private torrent: TorrentInterface;
  private peers: {socket: Socket; queue: Queue; pending: number}[];
  private path: string;
  private files: {path: string; length: number; offset: number; fd: number}[] =
    [];
  private tracker: {
    getPeers: (callback: (peers: PeerInterface[]) => void) => void;
  } | null = null;
  private reannounceTimer: ReturnType<typeof setInterval> | null = null;
  private knownPeerKeys: Set<string> = new Set();

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

    this.tracker.getPeers((peers: PeerInterface[]) => {
      peers.forEach(peer => this.connectToPeerAndDownload(peer));
    });

    this.reannounceTimer = setInterval(() => {
      if (!this.pieces.isDone() && this.peers.length < 5) {
        this.reannounce();
      }
    }, 30 * 1000);
  }

  private reannounce() {
    if (!this.tracker || this.pieces.isDone()) return;

    console.log(
      `Reannouncing to tracker (${this.peers.length} peers connected)...`
    );

    this.tracker.getPeers((peers: PeerInterface[]) => {
      for (const peer of peers) {
        const key = `${peer.ip}:${peer.port}`;
        if (!this.knownPeerKeys.has(key)) {
          this.knownPeerKeys.add(key);
          this.connectToPeerAndDownload(peer);
        }
      }
    });
  }

  private connectToPeerAndDownload(peer: PeerInterface) {
    const peerKey = `${peer.ip}:${peer.port}`;
    this.knownPeerKeys.add(peerKey);

    const socket = net.createConnection(peer.port, peer.ip, () => {
      socket.write(MessageHandler.buildHandshake(this.torrent));
    });

    const queue = new Queue(this.torrent);
    const peerState = {socket, queue, pending: 0};
    this.peers.push(peerState);

    const keepAliveInterval = setInterval(() => {
      socket.write(MessageHandler.buildKeepAlive());
    }, 30 * 1000);

    // Periodic stale-request cleanup: reset requested state and
    // re-trigger all peers so blocks stuck in "requested but not
    // received" limbo get re-requested.
    const staleTimer = setInterval(() => {
      if (!this.pieces.isDone()) {
        this.pieces.resetRequested();
        this.peers.forEach(p => this.requestPiece(p));
      }
    }, 10 * 1000);

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
      console.error(
        `TCP connection error: ${error.message} - ${this.peers.length} peers connected`
      );
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      clearInterval(keepAliveInterval);
      clearInterval(staleTimer);
      this.peers = this.peers.filter(p => p !== peerState);
      // Reset requested state so other peers can pick up stale blocks
      this.pieces.resetRequested();

      // If all peers are gone and download isn't done, reannounce
      if (this.peers.length === 0 && !this.pieces.isDone()) {
        console.log('All peers disconnected — reannouncing to tracker...');
        this.reannounce();
      }
    };

    socket.on('end', cleanup);
    socket.on('close', cleanup);
  }

  private onWholeMessage(socket: Socket, callback: (buffer: Buffer) => void) {
    let savedBuffer = Buffer.alloc(0);
    let handshake = true;

    socket.on('data', (message: Buffer) => {
      const getMessageLength = () =>
        handshake
          ? savedBuffer.readUInt8(0) + 49
          : savedBuffer.readInt32BE(0) + 4;
      savedBuffer = Buffer.concat([savedBuffer, message]);

      while (
        savedBuffer.length >= 4 &&
        savedBuffer.length >= getMessageLength()
      ) {
        callback(savedBuffer.slice(0, getMessageLength()));
        savedBuffer = savedBuffer.slice(getMessageLength());
        handshake = false;
      }
    });
  }

  private handleChoke(peer: {socket: Socket; queue: Queue; pending: number}) {
    peer.queue.chocked = true;
  }

  private handleUnchoke(peer: {socket: Socket; queue: Queue; pending: number}) {
    peer.queue.chocked = false;
    this.requestPiece(peer);
  }

  private handleHave(
    payload: Buffer,
    peer: {socket: Socket; queue: Queue; pending: number}
  ) {
    const pieceIndex = payload.readUInt32BE(0);
    peer.queue.add(pieceIndex);
    this.requestPiece(peer);
  }

  private handleBitfield(
    payload: Buffer,
    peer: {socket: Socket; queue: Queue; pending: number}
  ) {
    payload.forEach((byte, i) => {
      for (let j = 0; j < 8; j++) {
        if (byte % 2) {
          const pieceIndex = i * 8 + 7 - j;
          peer.queue.add(pieceIndex);
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
        console.error(`Error reading file(s): ${error.message}`);
        return;
      }
      const pieceMessage = MessageHandler.buildPiece({
        index: pieceIndex,
        begin: pieceBegin,
        block: buffer,
      });
      console.log('Sending piece message');
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
    peer: {socket: Socket; queue: Queue; pending: number}
  ) {
    // Track that we got a response
    peer.pending = Math.max(0, peer.pending - 1);

    // Don't process duplicate blocks
    if (this.pieces.isReceived(payload)) {
      this.requestPiece(peer);
      return;
    }

    this.pieces.addReceived(payload);
    this.pieces.printPercentDone();

    const offset =
      payload.index * this.torrent.info['piece length'] + payload.begin;

    this.writeToFiles(offset, payload.block as Buffer, () => {});

    const haveMessage = MessageHandler.buildHave(payload.index);
    this.peers.forEach(p => p.socket.write(haveMessage));

    if (this.pieces.isDone()) {
      this.onComplete();
    } else {
      // Bug 3 fix: In end-game, request missing blocks from ALL peers
      if (this.pieces.isEndGame()) {
        this.peers.forEach(p => this.requestPiece(p));
      } else {
        this.requestPiece(peer);
      }
    }
  }

  private onComplete() {
    try {
      if (this.reannounceTimer) {
        clearInterval(this.reannounceTimer);
        this.reannounceTimer = null;
      }
      this.peers.forEach(p => p.socket.end());
      this.files.forEach(f => fs.closeSync(f.fd));
      console.log('Download complete!');

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
          console.error(`Error writing to file: ${error.message}`);
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

  private requestPiece(peer: {socket: Socket; queue: Queue; pending: number}) {
    if (peer.queue.chocked) return;

    // Re-fill queue with missing blocks when empty so idle peers resume work
    if (peer.queue.length() === 0 && !this.pieces.isDone()) {
      const missingBlocks = this.pieces.getMissingBlocks();
      for (const block of missingBlocks) {
        peer.queue.enqueue(block);
      }
    }

    // Bug 2 fix: Send up to MAX_PIPELINE concurrent requests instead of just 1
    while (peer.pending < MAX_PIPELINE && peer.queue.length() > 0) {
      const pieceBlock = peer.queue.poll() as MessagePayloadInterface;

      if (this.pieces.needed(pieceBlock)) {
        peer.socket.write(MessageHandler.buildRequest(pieceBlock));
        this.pieces.addRequested(pieceBlock);
        peer.pending++;
      }
    }
  }
}

export default Downloader;
