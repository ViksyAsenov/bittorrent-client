// Implements all of the messages required for the peer wire protocol
// and parses incoming messages
// https://wiki.theory.org/BitTorrentSpecification#Messages

import MessagePayload from './types/MessagePayload';

class MessageHandler {
  private constructor() {}

  static parseMessage(message: Buffer) {
    // If the message isn't longer than 4, that means it is keep-alive
    // and has no id
    const id = message.length > 4 ? message.readInt8(4) : null;

    // If the message isn't longer than 5, that means it has no payload
    const payload = message.length > 5 ? message.slice(5) : null;

    let parsedPayload: MessagePayload | null = null;

    if (id === 6 || id === 7 || id === 8) {
      const rest = (payload as Buffer).slice(8);

      parsedPayload = {
        index: (payload as Buffer).readInt32BE(0),
        begin: (payload as Buffer).readInt32BE(4),
      };

      if (id === 7) {
        parsedPayload['block'] = rest;
      } else {
        parsedPayload['length'] = rest.length;
      }
    }

    return {
      size: message.readInt32BE(0),
      id,
      payload: parsedPayload,
    };
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
    const buffer = Buffer.alloc(14);

    // Length
    buffer.writeUInt32BE(bitfield.length + 1, 0);

    // Id
    buffer.writeUInt8(5, 4);

    // Bitfield
    bitfield.copy(buffer, 5);

    return buffer;
  }

  static buildRequest(payload: MessagePayload) {
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

  static buildPiece(payload: MessagePayload) {
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

  static buildCancel(payload: MessagePayload) {
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
