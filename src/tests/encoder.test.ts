import BencodeEncoder from '../encoder';

describe('BencodeEncoder', () => {
  let encoder: BencodeEncoder;

  beforeEach(() => {
    encoder = new BencodeEncoder();
  });

  test('should encode a string', () => {
    const result = encoder.encode('hello');
    expect(result).toEqual(new Uint8Array([53, 58, 104, 101, 108, 108, 111])); // 5:hello
  });

  test('should encode an integer', () => {
    const result = encoder.encode(123);
    expect(result).toEqual(new Uint8Array([105, 49, 50, 51, 101])); // i123e
  });

  test('should encode a list', () => {
    const result = encoder.encode([1, 'foo', 2]);
    expect(result).toEqual(
      new Uint8Array([
        108, 105, 49, 101, 51, 58, 102, 111, 111, 105, 50, 101, 101,
      ])
    ); // li1e3:fooi2ee
  });

  test('should encode a dictionary', () => {
    const result = encoder.encode({foo: 'bar', spam: 'eggs'});
    expect(result).toEqual(
      new Uint8Array([
        100, 51, 58, 102, 111, 111, 51, 58, 98, 97, 114, 52, 58, 115, 112, 97,
        109, 52, 58, 101, 103, 103, 115, 101,
      ])
    ); // d3:foo3:bar4:spam4:eggse
  });

  test('should encode nested structures', () => {
    const result = encoder.encode({foo: [1, 2, {bar: 'baz'}]});
    expect(result).toEqual(
      new Uint8Array([
        100, 51, 58, 102, 111, 111, 108, 105, 49, 101, 105, 50, 101, 100, 51,
        58, 98, 97, 114, 51, 58, 98, 97, 122, 101, 101, 101,
      ])
    ); // d3:fooli1ei2ed3:bar3:bazeee
  });

  test('should encode a Set', () => {
    const result = encoder.encode(new Set([1, 'foo', 2]));
    expect(result).toEqual(
      new Uint8Array([
        108, 105, 49, 101, 51, 58, 102, 111, 111, 105, 50, 101, 101,
      ])
    ); // li1e3:fooi2ee
  });

  test('should encode a Map', () => {
    const map = new Map();
    map.set('foo', 'bar');
    map.set('spam', 'eggs');
    const result = encoder.encode(map);
    expect(result).toEqual(
      new Uint8Array([
        100, 51, 58, 102, 111, 111, 51, 58, 98, 97, 114, 52, 58, 115, 112, 97,
        109, 52, 58, 101, 103, 103, 115, 101,
      ])
    ); // d3:foo3:bar4:spam4:eggse
  });

  test('should handle null values by ignoring them', () => {
    const result = encoder.encode([null, 'foo', null]);
    expect(result).toEqual(new Uint8Array([108, 51, 58, 102, 111, 111, 101])); // l3:fooe
  });

  test('should handle ArrayBuffers', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const result = encoder.encode(buffer);
    expect(result).toEqual(new Uint8Array([51, 58, 1, 2, 3])); // 3:\x01\x02\x03
  });

  test('should handle ArrayBufferViews', () => {
    const bufferView = new Uint8Array([1, 2, 3]);
    const result = encoder.encode(bufferView);
    expect(result).toEqual(new Uint8Array([51, 58, 1, 2, 3])); // 3:\x01\x02\x03
  });
});
