// Implements all of the messages required for the peer wire protocol
// and parses incoming messages
// https://wiki.theory.org/BitTorrentSpecification#Messages

import TorrentParser from './torrentParser';
import MessagePayloadInterface from './types/MessagePayload';
import TorrentInterface from './types/Torrent';
import generatePeerId from './utils/generatePeerId';

class MessageHandler {
  private constructor() {}

private static error(size: number, id: number, msg: string) {
  return { size, id, payload: null, error: msg };
}

static parseMessage(message: Buffer) {
  if (message.length < 4) {
    return this.error(0, -1, 'Message too short');
  }

  const size = message.readInt32BE(0);

  if (size === 0) {
    return { size, id: null, payload: null };
  }

  if (message.length < 5) {
    return this.error(size, -1, 'Missing message ID');
  }

  const id = message.readInt8(4);
  const payload = message.length > 5 ? message.slice(5) : null;

  switch (id) {
    case 4:
      if (!payload || payload.length < 4)
        return this.error(size, id, 'Malformed Have: payload too short');
      break;

    case 5:
      if (!payload)
        return this.error(size, id, 'Malformed Bitfield: missing payload');
      break;

    case 6:
    case 7:
    case 8: {
      if (!payload || payload.length < 8)
        return this.error(size, id, 'Malformed payload: too short');

      const parsedPayload: MessagePayloadInterface = {
        index: payload.readInt32BE(0),
        begin: payload.readInt32BE(4),
      };
      const rest = payload.slice(8);

      if (id === 7) {
        parsedPayload.block = rest;
      } else {
        if (rest.length < 4)
          return this.error(size, id, 'Malformed Request/Cancel: missing length');
        parsedPayload.length = rest.readInt32BE(0);
      }

      return { size, id, payload: parsedPayload };
    }

    case 9:
      if (!payload || payload.length < 2)
        return this.error(size, id, 'Malformed Port: payload too short');
      break;
  }

  return { size, id, payload };
}

  // Follows https://wiki.theory.org/BitTorrentSpecification#Handshake
  static buildHandshake(torrent: TorrentInterface) {
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
    generatePeerId().copy(buffer, 48);

    return buffer;
  }

  static isHandshake(message: Buffer, torrent: TorrentInterface) {
    return (
      message.length === 68 &&
      message.toString('utf8', 1, 20) === 'BitTorrent protocol' &&
      TorrentParser.getInfoHash(torrent) ===
        message.slice(28, 48).toString('hex')
    );
  }

  static buildKeepAlive() {
    return Buffer.alloc(4);
  }

  static buildChoke() {
    const buffer = Buffer.alloc(5);

    // Length
    buffer.writeUInt32BE(1, 0);

    // Id
    buffer.writeUInt8(0, 4);

    return buffer;
  }

  static buildUnchoke() {
    const buffer = Buffer.alloc(5);

    // Length
    buffer.writeUInt32BE(1, 0);

    // Id
    buffer.writeUInt8(1, 4);

    return buffer;
  }

  static buildInterested() {
    const buffer = Buffer.alloc(5);

    // Length
    buffer.writeUInt32BE(1, 0);

    // Id
    buffer.writeUInt8(2, 4);

    return buffer;
  }

  static buildUninterested() {
    const buffer = Buffer.alloc(5);

    // Length
    buffer.writeUInt32BE(1, 0);

    // Id
    buffer.writeUInt8(3, 4);

    return buffer;
  }

  static buildHave(payload: number) {
    const buffer = Buffer.alloc(9);

    // Length
    buffer.writeUInt32BE(5, 0);

    // Id
    buffer.writeUInt8(4, 4);

    // Piece index
    buffer.writeUInt32BE(payload, 5);

    return buffer;
  }

  static buildBitfield(bitfield: Buffer) {
    const buffer = Buffer.alloc(bitfield.length + 5);

    // Length
    buffer.writeUInt32BE(bitfield.length + 1, 0);

    // Id
    buffer.writeUInt8(5, 4);

    // Bitfield
    bitfield.copy(buffer, 5);

    return buffer;
  }

  static buildRequest(payload: MessagePayloadInterface) {
    const buffer = Buffer.alloc(17);

    // Length
    buffer.writeUInt32BE(13, 0);

    // Id
    buffer.writeUInt8(6, 4);

    // Piece index
    buffer.writeUInt32BE(payload.index, 5);

    // Begin
    buffer.writeUInt32BE(payload.begin, 9);

    // Length
    buffer.writeUInt32BE(payload.length as number, 13);

    return buffer;
  }

  static buildPiece(payload: MessagePayloadInterface) {
    const buffer = Buffer.alloc((payload.block as Buffer).length + 13);

    // Length
    buffer.writeUInt32BE((payload.block as Buffer).length + 9, 0);

    // Id
    buffer.writeUInt8(7, 4);

    // Piece index
    buffer.writeUInt32BE(payload.index, 5);

    // Begin
    buffer.writeUInt32BE(payload.begin, 9);

    // Block
    (payload.block as Buffer).copy(buffer, 13);

    return buffer;
  }

  static buildCancel(payload: MessagePayloadInterface) {
    const buffer = Buffer.alloc(17);

    // Length
    buffer.writeUInt32BE(13, 0);

    // Id
    buffer.writeUInt8(8, 4);

    // Piece index
    buffer.writeUInt32BE(payload.index, 5);

    // Begin
    buffer.writeUInt32BE(payload.begin, 9);

    // Payload length
    buffer.writeUInt32BE(payload.length as number, 13);

    return buffer;
  }

  static buildPort(payload: number) {
    const buffer = Buffer.alloc(7);

    // Length
    buffer.writeUInt32BE(3, 0);

    // Id
    buffer.writeUInt8(9, 4);

    // Listen port
    buffer.writeUInt16BE(payload, 5);

    return buffer;
  }
}

export default MessageHandler;
