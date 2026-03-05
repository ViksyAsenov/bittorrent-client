import MessageHandler from '../message';

describe('MessageHandler', () => {
  describe('parseMessage', () => {
    test('should catch malformed Request message with insufficient payload', () => {
      // id 6 (Request) requires at least 12 bytes of payload (index, begin, length)
      // total message length should be 4 (size) + 1 (id) + 12 (payload) = 17 bytes
      const malformedRequest = Buffer.alloc(9);
      malformedRequest.writeInt32BE(5, 0); // length 5 (1 id + 4 payload)
      malformedRequest.writeInt8(6, 4);    // id 6 (Request)
      
      const parsed = MessageHandler.parseMessage(malformedRequest);
      
      expect(parsed.error).toBe('Malformed payload: too short');
      expect(parsed.payload).toBeNull();
    });

    test('should catch malformed Have message with insufficient payload', () => {
      // id 4 (Have) requires exactly 4 bytes of payload (piece index)
      // total message length should be 4 (size) + 1 (id) + 4 (payload) = 9 bytes
      const malformedHave = Buffer.alloc(7);
      malformedHave.writeInt32BE(3, 0); // length 3 (1 id + 2 payload)
      malformedHave.writeInt8(4, 4);    // id 4 (Have)
      
      const parsed = MessageHandler.parseMessage(malformedHave);
      
      expect(parsed.error).toBe('Malformed Have: payload too short');
      expect(parsed.payload).toBeNull();
    });

    test('should correctly parse a valid Request message', () => {
      const requestMessage = Buffer.alloc(17);
      requestMessage.writeInt32BE(13, 0); // length 13
      requestMessage.writeInt8(6, 4);     // id 6
      requestMessage.writeInt32BE(1, 5);  // index 1
      requestMessage.writeInt32BE(0, 9);  // begin 0
      requestMessage.writeInt32BE(16384, 13); // length 16384
      
      const parsed = MessageHandler.parseMessage(requestMessage);
      
      expect(parsed.error).toBeUndefined();
      expect(parsed.id).toBe(6);
      expect(parsed.payload).toEqual({
        index: 1,
        begin: 0,
        length: 16384
      });
    });

    test('should correctly parse a valid Have message', () => {
      const haveMessage = Buffer.alloc(9);
      haveMessage.writeInt32BE(5, 0); // length 5
      haveMessage.writeInt8(4, 4);    // id 4
      haveMessage.writeInt32BE(42, 5); // index 42
      
      const parsed = MessageHandler.parseMessage(haveMessage);
      
      expect(parsed.error).toBeUndefined();
      expect(parsed.id).toBe(4);
      // Valid Have messages return the payload as a Buffer in the current implementation
      // unless specifically handled otherwise (it's slice(5))
      expect(parsed.payload).toBeInstanceOf(Buffer);
      expect((parsed.payload as Buffer).readInt32BE(0)).toBe(42);
    });
  });
});
