import Torrent from './types/Torrent';
import TrackerBuilder from './tracker';
import {Peer} from './types/TrackerResponse';
import MessageHandler from './message';
import MessagePayload from './types/MessagePayload';
import net, {Socket} from 'net';

function onWholeMessage(socket: Socket, callback: (buffer: Buffer) => void) {
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

class Downloader {
  private constructor() {}

  static download(torrent: Torrent) {
    const tracker = TrackerBuilder.buildTracker(torrent);

    tracker.getPeers((peers: Peer[]) => {
      peers.forEach(peer => this.connectToPeer(peer, torrent));
    });
  }

  private static connectToPeer(peer: Peer, torrent: Torrent) {
    // 1. Send connection request
    const socket = net.createConnection(peer.port, peer.ip, () => {
      socket.write(MessageHandler.buildHandshake(torrent));
    });

    // 2. Make sure the whole message is returned then check
    //    if handshake is valid and finally let them know we are interested
    //    or handle the other possible requests
    onWholeMessage(socket, (message: Buffer) => {
      if (MessageHandler.isHandshake(message, torrent)) {
        console.log('INTERESTED');
        socket.write(MessageHandler.buildInterested());
      } else {
        const parsedMessage = MessageHandler.parseMessage(message);
        switch (parsedMessage.id) {
          case 0:
            this.handleChoke();
            break;
          case 1:
            this.handleUnchoke();
            break;
          case 4:
            this.handleHave(parsedMessage.payload as MessagePayload);
            break;
          case 5:
            this.handleBitfield(parsedMessage.payload as MessagePayload);
            break;
          case 7:
            this.handlePiece(parsedMessage.payload as MessagePayload);
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

  private static handleChoke() {}

  private static handleUnchoke() {}

  private static handleHave(payload: MessagePayload) {}

  private static handleBitfield(payload: MessagePayload) {}

  private static handlePiece(payload: MessagePayload) {}
}

export default Downloader;
