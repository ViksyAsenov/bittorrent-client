import Torrent from './types/Torrent';
import TrackerBuilder from './tracker';
import {Peer} from './types/TrackerResponse';
import MessageHandler from './message';
import MessagePayload from './types/MessagePayload';
import net, {Socket} from 'net';
import Pieces from './pieces';
import QueueData from './types/QueueData';

// TODO: Finish implementing pieces and queue
class Downloader {
  //private pieces: Pieces;
  private torrent: Torrent;

  constructor(torrent: Torrent) {
    //this.pieces = new Pieces(torrent.info.pieces.length / 20);
    this.torrent = torrent;
  }

  download() {
    const tracker = TrackerBuilder.buildTracker(this.torrent);

    tracker.getPeers((peers: Peer[]) => {
      peers.forEach(peer => this.connectToPeerAndDownload(peer));
    });
  }

  private connectToPeerAndDownload(peer: Peer) {
    // 1. Send connection request
    const socket = net.createConnection(peer.port, peer.ip, () => {
      socket.write(MessageHandler.buildHandshake(this.torrent));
    });

    const queueData: QueueData = {chocked: true, queue: []};

    // 2. Make sure the whole message is returned then check
    //    if handshake is valid and finally let them know we are interested
    //    or handle the other possible requests
    this.onWholeMessage(socket, (message: Buffer) => {
      if (MessageHandler.isHandshake(message, this.torrent)) {
        socket.write(MessageHandler.buildInterested());
        console.log('interested');
      } else {
        const parsedMessage = MessageHandler.parseMessage(message);

        switch (parsedMessage.id) {
          case 0:
            this.handleChoke(socket);
            break;
          case 1:
            this.handleUnchoke(socket, queueData);
            break;
          case 4:
            this.handleHave(
              parsedMessage.payload as MessagePayload,
              socket,
              queueData
            );
            break;
          case 5:
            this.handleBitfield(parsedMessage.payload as MessagePayload);
            break;
          case 7:
            this.handlePiece(
              parsedMessage.payload as MessagePayload,
              socket,
              queueData
            );
            break;
        }
      }
    });

    socket.on('error', (error: Error) => {
      console.error(`TCP connection error: ${error.message}`);
    });

    socket.on('end', () => {
      console.log('Connection closed');
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

  private handleChoke(socket: Socket) {
    socket.end();
  }

  private handleUnchoke(socket: Socket, queue: QueueData) {
    queue.chocked = false;

    this.requestPiece(socket, queue);
  }

  private handleHave(
    payload: MessagePayload,
    socket: Socket,
    queueData: QueueData
  ) {
    const pieceIndex = payload.index;
    queueData.queue.push(pieceIndex);

    if (queueData.queue.length === 1) {
      this.requestPiece(socket, queueData);
    }
    // if (!this.requested[pieceIndex]) {
    //   socket.write(MessageHandler.buildRequest());
    // }

    // this.requested[pieceIndex] = true;
  }

  private handleBitfield(payload: MessagePayload) {}

  private handlePiece(
    payload: MessagePayload,
    socket: Socket,
    queueData: QueueData
  ) {
    queueData.queue.shift();
    this.requestPiece(socket, queueData);
  }

  private requestPiece(socket: Socket, queueData: QueueData) {
    if (queueData.chocked) return;

    while (queueData.queue.length > 0) {
      const pieceIndex = queueData.queue.shift() as number;

      // if (this.pieces.needed(pieceIndex)) {
      //   socket.write(MessageHandler.buildRequest(pieceIndex));
      //   this.pieces.addRequested(pieceIndex);
      //   break;
      // }
    }
  }
}

export default Downloader;
