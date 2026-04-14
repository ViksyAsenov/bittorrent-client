import MessageHandler from '../message';
import BencodeDecoder from '../decoder';

describe('BEP 10 Extension Protocol', () => {
  describe('buildHandshakeFromHash', () => {
    test('sets BEP 10 reserved bit', () => {
      const hash = 'aabbccddee11223344556677889900aabbccddee';
      const handshake = MessageHandler.buildHandshakeFromHash(hash);

      expect(handshake.length).toBe(68);
      expect(handshake.toString('utf8', 1, 20)).toBe('BitTorrent protocol');

      // Reserved byte 5 (offset 25) should have bit 4 (0x10) set
      expect(handshake[25] & 0x10).toBe(0x10);

      // Info hash at offset 28-48
      expect(handshake.slice(28, 48).toString('hex')).toBe(hash);
    });
  });

  describe('peerSupportsExtension', () => {
    test('returns true when BEP 10 bit is set', () => {
      const handshake = Buffer.alloc(68);
      handshake[25] = 0x10;
      expect(MessageHandler.peerSupportsExtension(handshake)).toBe(true);
    });

    test('returns false when BEP 10 bit is not set', () => {
      const handshake = Buffer.alloc(68);
      handshake[25] = 0x00;
      expect(MessageHandler.peerSupportsExtension(handshake)).toBe(false);
    });

    test('returns true when other bits are also set', () => {
      const handshake = Buffer.alloc(68);
      handshake[25] = 0xff; // All bits set
      expect(MessageHandler.peerSupportsExtension(handshake)).toBe(true);
    });
  });

  describe('isHandshakeForHash', () => {
    test('verifies handshake matches info hash', () => {
      const hash = 'aabbccddee11223344556677889900aabbccddee';
      const handshake = MessageHandler.buildHandshakeFromHash(hash);

      expect(MessageHandler.isHandshakeForHash(handshake, hash)).toBe(true);
    });

    test('rejects mismatched info hash', () => {
      const hash = 'aabbccddee11223344556677889900aabbccddee';
      const handshake = MessageHandler.buildHandshakeFromHash(hash);

      expect(
        MessageHandler.isHandshakeForHash(
          handshake,
          '1111111111111111111111111111111111111111'
        )
      ).toBe(false);
    });
  });

  describe('buildExtensionHandshake', () => {
    test('builds valid extension handshake message', () => {
      const msg = MessageHandler.buildExtensionHandshake();

      // Message ID should be 20 (extended)
      expect(msg.readUInt8(4)).toBe(20);

      // Extension ID should be 0 (handshake)
      expect(msg.readUInt8(5)).toBe(0);

      // Decode the bencoded payload
      const payload = BencodeDecoder.decode(msg.slice(6)) as Record<
        string,
        unknown
      >;
      expect(payload.m).toBeDefined();
      expect((payload.m as Record<string, number>).ut_metadata).toBe(2);
    });

    test('includes metadata_size when provided', () => {
      const msg = MessageHandler.buildExtensionHandshake(12345);
      const payload = BencodeDecoder.decode(msg.slice(6)) as Record<
        string,
        unknown
      >;

      expect(payload.metadata_size).toBe(12345);
    });

    test('length prefix is correct', () => {
      const msg = MessageHandler.buildExtensionHandshake();
      const length = msg.readUInt32BE(0);

      // Length should be total message minus the 4-byte length prefix
      expect(length).toBe(msg.length - 4);
    });
  });

  describe('buildMetadataRequest', () => {
    test('builds valid metadata request message', () => {
      const msg = MessageHandler.buildMetadataRequest(3, 5);

      // Message ID should be 20
      expect(msg.readUInt8(4)).toBe(20);

      // Extension ID should be 3 (peer's ut_metadata ID)
      expect(msg.readUInt8(5)).toBe(3);

      // Decode payload
      const payload = BencodeDecoder.decode(msg.slice(6)) as Record<
        string,
        unknown
      >;
      expect(payload.msg_type).toBe(0); // Request
      expect(payload.piece).toBe(5);
    });
  });

  describe('parseExtensionMessage', () => {
    test('parses extension handshake', () => {
      const msg = MessageHandler.buildExtensionHandshake(50000);
      // The payload starts after the 4-byte length + 1-byte msg ID
      const payload = msg.slice(5);
      const parsed = MessageHandler.parseExtensionMessage(payload);

      expect(parsed).not.toBeNull();
      expect(parsed!.extensionId).toBe(0);
      expect(parsed!.dict.m).toBeDefined();
      expect(parsed!.dict.metadata_size).toBe(50000);
    });

    test('parses metadata data response with trailing data', () => {
      // Simulate a metadata data response: bencoded dict + raw piece data
      const dictPayload = {msg_type: 1, piece: 0, total_size: 100};
      const {default: BencodeEncoder} = require('../encoder');
      const encodedDict = BencodeEncoder.encode(dictPayload);
      const trailingData = Buffer.from('raw-metadata-piece-data');

      const payload = Buffer.alloc(
        1 + encodedDict.length + trailingData.length
      );
      payload.writeUInt8(2, 0); // Extension ID
      Buffer.from(encodedDict).copy(payload, 1);
      trailingData.copy(payload, 1 + encodedDict.length);

      const parsed = MessageHandler.parseExtensionMessage(payload);

      expect(parsed).not.toBeNull();
      expect(parsed!.extensionId).toBe(2);
      expect(parsed!.dict.msg_type).toBe(1);
      expect(parsed!.dict.piece).toBe(0);
      expect(parsed!.trailing.toString()).toBe('raw-metadata-piece-data');
    });

    test('returns null for too-short payload', () => {
      expect(MessageHandler.parseExtensionMessage(Buffer.alloc(0))).toBeNull();
      expect(MessageHandler.parseExtensionMessage(Buffer.alloc(1))).toBeNull();
    });
  });
});
