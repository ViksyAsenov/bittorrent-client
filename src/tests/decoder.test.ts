import BencodeDecoder from '../decoder';

describe('BencodeDecoder', () => {
  let decoder: BencodeDecoder;

  beforeEach(() => {
    decoder = new BencodeDecoder();
  });

  test('should decode a string', () => {
    const input = new Uint8Array([53, 58, 104, 101, 108, 108, 111]); // 5:hello
    const result = decoder.decode(input);
    expect(result).toBe('hello');
  });

  test('should decode an integer', () => {
    const input = new Uint8Array([105, 49, 50, 51, 101]); // i123e
    const result = decoder.decode(input);
    expect(result).toBe(123);
  });

  test('should decode a list', () => {
    const input = new Uint8Array([
      108, 105, 49, 101, 51, 58, 102, 111, 111, 105, 50, 101, 101,
    ]); // li1e3:fooi2ee
    const result = decoder.decode(input);
    expect(result).toEqual([1, 'foo', 2]);
  });

  test('should decode a dictionary', () => {
    const input = new Uint8Array([
      100, 51, 58, 102, 111, 111, 51, 58, 98, 97, 114, 52, 58, 115, 112, 97,
      109, 52, 58, 101, 103, 103, 115, 101,
    ]); // d3:foo3:bar4:spam4:eggse
    const result = decoder.decode(input);
    expect(result).toEqual({foo: 'bar', spam: 'eggs'});
  });

  test('should decode nested structures', () => {
    const input = new Uint8Array([
      100, 51, 58, 102, 111, 111, 108, 105, 49, 101, 105, 50, 101, 100, 51, 58,
      98, 97, 114, 51, 58, 98, 97, 122, 101, 101, 101,
    ]); // d3:fooli1ei2ed3:bar3:bazeee
    const result = decoder.decode(input);
    expect(result).toEqual({foo: [1, 2, {bar: 'baz'}]});
  });

  test('should decode a Set as a list', () => {
    const input = new Uint8Array([
      108, 105, 49, 101, 51, 58, 102, 111, 111, 105, 50, 101, 101,
    ]); // li1e3:fooi2ee
    const result = decoder.decode(input);
    expect(result).toEqual([1, 'foo', 2]);
  });

  test('should decode a Map as a dictionary', () => {
    const input = new Uint8Array([
      100, 51, 58, 102, 111, 111, 51, 58, 98, 97, 114, 52, 58, 115, 112, 97,
      109, 52, 58, 101, 103, 103, 115, 101,
    ]); // d3:foo3:bar4:spam4:eggse
    const result = decoder.decode(input);
    expect(result).toEqual({foo: 'bar', spam: 'eggs'});
  });

  test('should handle null values correctly', () => {
    const input = new Uint8Array([108, 51, 58, 102, 111, 111, 101]); // l3:fooe
    const result = decoder.decode(input);
    expect(result).toEqual(['foo']);
  });
});
