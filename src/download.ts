import net, {Socket} from 'net';
import Torrent from './types/Torrent';
import TrackerBuilder from './tracker';
import {Peer} from './types/TrackerResponse';
import TorrentParser from './torrentParser';
import generatePeerId from './utils/generatePeerId';
import {arr2text} from './utils/uint8';
import MessageHandler from './message';
import MessagePayload from './types/MessagePayload';

class Downloader {
  private constructor() {}

  static download(torrent: Torrent) {
    const tracker = TrackerBuilder.buildTracker(torrent);

    tracker.getPeers((peers: Peer[]) => {
      peers.forEach(peer => this.connectToPeer(peer, torrent));
    });
  }

  private static connectToPeer(peer: Peer, torrent: Torrent) {
    const socket = new net.Socket();

    socket.connect(peer.port, peer.ip, () => {
      // 1. Send connection request
      console.log('connected');
      socket.write(this.buildHandshake(torrent));
    });

    // 2. Make sure the whole message is returned then check
    //    if handshake is valid and finally let them know we are interested
    //    or handle the other possible requests
    this.onWholeMessage(socket, (message: Buffer) => {
      if (this.isHandshake(message)) {
        socket.write(MessageHandler.buildInterested());
      } else {
        const parsedMessage = MessageHandler.parseMessage(message);
        console.log('interested');
        console.log(parsedMessage.id);
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
  }

  private static onWholeMessage(
    socket: Socket,
    callback: (buffer: Buffer) => void
  ) {
    let savedBuffer = Buffer.alloc(0);
    let handshake = true;

    socket.on('data', request => {
      const getMessageLength = () =>
        handshake
          ? savedBuffer.readUInt8(0) + 49
          : savedBuffer.readInt32BE(0) + 4;
      savedBuffer = Buffer.concat([savedBuffer, request]);

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

  // Follows https://wiki.theory.org/BitTorrentSpecification#Handshake
  private static buildHandshake(torrent: Torrent) {
    const buffer = Buffer.alloc(68);

    // Pstrlen
    buffer.writeUInt8(19, 0);

    // Pstr
    buffer.write('BitTorrent protocol', 1);

    // Reserved
    buffer.writeUInt32BE(0, 20);
    buffer.writeUInt32BE(0, 24);

    // Info Hash
    Buffer.from(TorrentParser.getInfoHash(torrent), 'hex').copy(buffer, 28);

    // Peer id
    buffer.write(arr2text(generatePeerId()));

    return buffer;
  }

  // The handshake is (49+len(pstr)) bytes long and must follow the BitTorrent Protocol
  private static isHandshake(message: Buffer) {
    return (
      message.length === message.readUInt8(0) + 49 &&
      message.toString('utf8', 1) === 'BitTorrent protocol'
    );
  }

  private static handleChoke() {}

  private static handleUnchoke() {}

  private static handleHave(payload: MessagePayload) {}

  private static handleBitfield(payload: MessagePayload) {}

  private static handlePiece(payload: MessagePayload) {}
}

export default Downloader;
