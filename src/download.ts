import Torrent from './types/Torrent';
import TrackerBuilder from './tracker';
import {Peer} from './types/TrackerResponse';
import MessageHandler from './message';
import MessagePayload from './types/MessagePayload';
import net, {Socket} from 'net';
import Pieces from './pieces';
import Queue from './queue';
import * as fs from 'fs';

class Downloader {
  private pieces: Pieces;
  private torrent: Torrent;
  private peers: Socket[];
  private path: string;
  private file: number;

  constructor(torrent: Torrent, path: string) {
    this.pieces = new Pieces(torrent);
    this.torrent = torrent;
    this.peers = [];
    this.path = path;
    this.file = fs.openSync(path, 'w');
  }

  download() {
    const tracker = TrackerBuilder.buildTracker(this.torrent);

    tracker.getPeers((peers: Peer[]) => {
      peers.forEach(peer => this.connectToPeerAndDownload(peer));
    });
  }

  private connectToPeerAndDownload(peer: Peer) {
    const socket = net.createConnection(peer.port, peer.ip, () => {
      socket.write(MessageHandler.buildHandshake(this.torrent));
    });

    this.peers.push(socket);

    setInterval(() => {
      socket.write(MessageHandler.buildKeepAlive());
    }, 90 * 1000);

    const queue = new Queue(this.torrent);

    this.onWholeMessage(socket, (message: Buffer) => {
      if (MessageHandler.isHandshake(message, this.torrent)) {
        socket.write(MessageHandler.buildInterested());
        console.log(
          `Interested with ${message.slice(49, 51).toString()}-${socket.remoteAddress}`
        );

        // Send bitfield message after the handshake
        const bitfield = this.pieces.getBitfield();
        if (bitfield.length > 0) {
          socket.write(MessageHandler.buildBitfield(bitfield));
        }
      } else {
        const parsedMessage = MessageHandler.parseMessage(message);

        switch (parsedMessage.id) {
          case 0:
            this.handleChoke(socket, queue);
            break;
          case 1:
            this.handleUnchoke(socket, queue);
            break;
          case 4:
            this.handleHave(message, socket, queue);
            break;
          case 5:
            this.handleBitfield(message, socket, queue);
            break;
          case 6:
            this.handleRequest(parsedMessage.payload as MessagePayload, socket);
            break;
          case 7:
            this.handlePiece(
              parsedMessage.payload as MessagePayload,
              socket,
              queue
            );
            break;
        }
      }
    });

    socket.on('error', (error: Error) => {
      console.error(`TCP connection error: ${error.message}`);
    });

    socket.on('end', () => {
      console.log(`Connection closed with ${socket.remoteAddress}`);
      this.peers = this.peers.filter(s => s !== socket);
    });
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

  private handleChoke(socket: Socket, queue: Queue) {
    queue.chocked = true;
    console.log(`Chocked with ${socket.remoteAddress}`);
  }

  private handleUnchoke(socket: Socket, queue: Queue) {
    queue.chocked = false;
    console.log(`Unchocked with ${socket.remoteAddress}`);
    this.requestPiece(socket, queue);
  }

  private handleHave(payload: Buffer, socket: Socket, queue: Queue) {
    const pieceIndex = payload.readUInt32BE(0);
    queue.add(pieceIndex);
    this.requestPiece(socket, queue);
  }

  private handleBitfield(payload: Buffer, socket: Socket, queue: Queue) {
    payload.forEach((byte, i) => {
      for (let j = 0; j < 8; j++) {
        if (byte % 2) {
          const pieceIndex = i * 8 + 7 - j;
          queue.add(pieceIndex);
        }
        byte = Math.floor(byte / 2);
      }
    });

    this.requestPiece(socket, queue);
  }

  private handleRequest(payload: MessagePayload, socket: Socket) {
    const pieceIndex = payload.index;
    const pieceBegin = payload.begin;
    const pieceLength = payload.length as number;

    const offset = pieceIndex * this.torrent.info['piece length'] + pieceBegin;

    const pieceBuffer = Buffer.alloc(pieceLength);
    fs.read(
      fs.openSync(this.path, 'r'),
      pieceBuffer,
      0,
      pieceLength,
      offset,
      (err, bytesRead, buffer) => {
        if (err) {
          console.error(`Error reading file: ${err.message}`);
          return;
        }

        console.log('Sending');
        const pieceMessage = MessageHandler.buildPiece({
          index: pieceIndex,
          begin: pieceBegin,
          block: buffer,
        });
        socket.write(pieceMessage);
      }
    );
  }

  private handlePiece(payload: MessagePayload, socket: Socket, queue: Queue) {
    this.pieces.addReceived(payload);
    this.pieces.printPercentDone();

    const offset =
      payload.index * this.torrent.info['piece length'] + payload.begin;

    fs.write(
      this.file,
      payload.block as Buffer,
      0,
      (payload.block as Buffer).length,
      offset,
      () => {}
    );

    // Notify all peers that we have this piece
    const haveMessage = MessageHandler.buildHave(payload.index);
    this.peers.forEach(peerSocket => peerSocket.write(haveMessage));

    if (this.pieces.isDone()) {
      console.log('DONE!');
      socket.end();
      try {
        fs.closeSync(this.file);
      } catch (e) {
        console.error(e);
      }
    } else {
      this.requestPiece(socket, queue);
    }
  }

  private requestPiece(socket: Socket, queue: Queue) {
    if (queue.chocked) return;

    while (queue.length() > 0) {
      const pieceBlock = queue.poll() as MessagePayload;

      if (this.pieces.needed(pieceBlock)) {
        socket.write(MessageHandler.buildRequest(pieceBlock));
        this.pieces.addRequested(pieceBlock);
        break;
      }
    }
  }
}

export default Downloader;
