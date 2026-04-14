// Implements all of the messages required for the peer wire protocol
// and parses incoming messages
// https://wiki.theory.org/BitTorrentSpecification#Messages
// Also implements BEP 10 (Extension Protocol) messages

import TorrentParser from './torrentParser';
import MessagePayloadInterface from './types/MessagePayload';
import TorrentInterface from './types/Torrent';
import generatePeerId from './utils/generatePeerId';
import BencodeEncoder from './encoder';
import BencodeDecoder from './decoder';

class MessageHandler {
  private constructor() {}

  private static error(size: number, id: number, msg: string) {
    return {size, id, payload: null, error: msg};
  }

  static parseMessage(message: Buffer): {
    size: number;
    id: number | null;
    payload: MessagePayloadInterface | Buffer | null;
    error?: string;
  } {
    if (message.length < 4) {
      return this.error(0, -1, 'Message too short');
    }

    const size = message.readInt32BE(0);

    if (size === 0) {
      return {size, id: null, payload: null};
    }

    if (message.length < 5) {
      return this.error(size, -1, 'Missing message ID');
    }

    const id = message.readInt8(4);
    const payload = message.length > 5 ? message.slice(5) : null;

    switch (id) {
      case 4:
        if (!payload || payload.length < 4) {
          return this.error(size, id, 'Malformed Have: payload too short');
        }

        break;
      case 5:
        if (!payload) {
          return this.error(size, id, 'Malformed Bitfield: missing payload');
        }

        break;
      case 6:
      case 7:
      case 8: {
        if (!payload || payload.length < 8) {
          return this.error(size, id, 'Malformed payload: too short');
        }

        const parsedPayload: MessagePayloadInterface = {
          index: payload.readInt32BE(0),
          begin: payload.readInt32BE(4),
        };
        const rest = payload.slice(8);

        if (id === 7) {
          parsedPayload.block = rest;
        } else {
          if (rest.length < 4)
            return this.error(
              size,
              id,
              'Malformed Request/Cancel: missing length'
            );

          parsedPayload.length = rest.readInt32BE(0);
        }

        return {size, id, payload: parsedPayload};
      }

      case 9:
        if (!payload || payload.length < 2) {
          return this.error(size, id, 'Malformed Port: payload too short');
        }

        break;
    }

    return {size, id, payload};
  }

  // Follows https://wiki.theory.org/BitTorrentSpecification#Handshake
  static buildHandshake(torrent: TorrentInterface) {
    const infoHash = TorrentParser.getInfoHash(torrent);

    return this.buildHandshakeFromHash(infoHash);
  }

  // Build handshake from a raw hex info hash (used for magnet links)
  static buildHandshakeFromHash(infoHashHex: string) {
    const buffer = Buffer.alloc(68);

    // Pstrlen
    buffer.writeUInt8(19, 0);

    // Pstr
    buffer.write('BitTorrent protocol', 1);

    // Reserved — set BEP 10 extension protocol bit (byte 5, bit 4 = 0x10)
    buffer.writeUInt32BE(0, 20);
    buffer.writeUInt32BE(0, 24);
    buffer[25] = 0x10; // reserved byte 5 (offset 20+5=25)

    // Info Hash
    Buffer.from(infoHashHex, 'hex').copy(buffer, 28);

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

  static isHandshakeForHash(message: Buffer, infoHashHex: string) {
    return (
      message.length === 68 &&
      message.toString('utf8', 1, 20) === 'BitTorrent protocol' &&
      infoHashHex === message.slice(28, 48).toString('hex')
    );
  }

  // Check if the peer supports BEP 10 extension protocol
  static peerSupportsExtension(handshake: Buffer): boolean {
    return handshake.length >= 28 && (handshake[25] & 0x10) !== 0;
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

  // BEP 10 Extension Protocol

  // Build extension handshake (msg ID 20, extension ID 0)
  // Advertises our ut_metadata support and optionally our metadata_size
  static buildExtensionHandshake(metadataSize?: number) {
    const payload: Record<string, unknown> = {
      m: {ut_metadata: 2}, // We assign extension ID 2 for ut_metadata
    };

    if (metadataSize !== undefined) {
      payload.metadata_size = metadataSize;
    }

    const bencoded = BencodeEncoder.encode(payload);
    const buffer = Buffer.alloc(4 + 1 + 1 + bencoded.length);

    // Length prefix (1 byte msg ID + 1 byte extension ID + bencoded payload)
    buffer.writeUInt32BE(2 + bencoded.length, 0);

    // Message ID 20 = extended
    buffer.writeUInt8(20, 4);

    // Extension message ID 0 = handshake
    buffer.writeUInt8(0, 5);

    // Bencoded payload
    Buffer.from(bencoded).copy(buffer, 6);

    return buffer;
  }

  // Build a metadata request (BEP 9: msg_type=0)
  static buildMetadataRequest(peerExtensionId: number, piece: number) {
    const payload = BencodeEncoder.encode({msg_type: 0, piece});
    const buffer = Buffer.alloc(4 + 1 + 1 + payload.length);

    buffer.writeUInt32BE(2 + payload.length, 0);
    buffer.writeUInt8(20, 4);
    buffer.writeUInt8(peerExtensionId, 5);
    Buffer.from(payload).copy(buffer, 6);

    return buffer;
  }

  // Parse an extension message (msg ID 20)
  // Returns the extension ID and decoded bencoded dictionary + any trailing data
  static parseExtensionMessage(payload: Buffer): {
    extensionId: number;
    dict: Record<string, unknown>;
    trailing: Buffer;
  } | null {
    if (!payload || payload.length < 2) return null;

    const extensionId = payload.readUInt8(0);
    const bencodedData = payload.slice(1);

    try {
      // Find the end of the bencoded dictionary to separate trailing data
      // The dictionary starts with 'd' and we need to find where it ends
      let depth = 0;
      let i = 0;
      const data = bencodedData;

      // Simple bencoded end finder: track 'd'/'l' depth vs 'e'
      for (i = 0; i < data.length; i++) {
        const byte = data[i];

        if (byte === 0x64 || byte === 0x6c) {
          // 'd' or 'l'
          depth++;
        } else if (byte === 0x65) {
          // 'e'
          depth--;
          if (depth === 0) {
            i++; // Move past the closing 'e'
            break;
          }
        } else if (byte >= 0x30 && byte <= 0x39) {
          // Digit — start of a string length prefix
          // Find the ':' delimiter
          let j = i;
          while (j < data.length && data[j] !== 0x3a) j++;
          // Parse the length
          const strLen = parseInt(data.slice(i, j).toString('ascii'), 10);
          // Skip past the string content
          i = j + strLen; // -1 because the for loop will i++
        } else if (byte === 0x69) {
          // 'i' — integer, find the closing 'e'
          while (i < data.length && data[i] !== 0x65) i++;
          // The 'e' will be handled by the for loop's next iteration
        }
      }

      const dictBytes = bencodedData.slice(0, i);
      const trailing = bencodedData.slice(i);

      const dict = BencodeDecoder.decode(dictBytes) as Record<string, unknown>;

      return {extensionId, dict, trailing: Buffer.from(trailing)};
    } catch {
      return null;
    }
  }
}

export default MessageHandler;
