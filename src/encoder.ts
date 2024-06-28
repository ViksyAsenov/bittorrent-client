import {concat, text2arr, getType} from './utils/uint8';

// Bencode encoder
// For more information on this format
// https://en.wikipedia.org/wiki/Bencode

class BencodeEncoder {
  private static _floatConversionDetected: boolean;
  private static buffE = new Uint8Array([0x65]);
  private static buffD = new Uint8Array([0x64]);
  private static buffL = new Uint8Array([0x6c]);

  public static encode(
    data: unknown,
    buffer?: Uint8Array,
    offset?: number
  ): Uint8Array {
    this._floatConversionDetected = false;
    const buffers: Uint8Array[] = [];
    let result: Uint8Array | null = null;

    this._encode(buffers, data);
    result = concat(buffers);

    if (ArrayBuffer.isView(buffer)) {
      buffer.set(result, offset);
      return buffer;
    }

    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _encode(buffers: Uint8Array[], data: any): void {
    if (data === null) {
      return;
    }

    switch (getType(data)) {
      case 'object':
        this.encodeDict(buffers, data);
        break;
      case 'map':
        this.encodeDictMap(buffers, data);
        break;
      case 'array':
        this.encodeList(buffers, data);
        break;
      case 'set':
        this.encodeListSet(buffers, data);
        break;
      case 'string':
        this.encodeString(buffers, data);
        break;
      case 'number':
        this.encodeNumber(buffers, data);
        break;
      case 'boolean':
        this.encodeNumber(buffers, data);
        break;
      case 'arraybufferview':
        this.encodeBuffer(
          buffers,
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        );
        break;
      case 'arraybuffer':
        this.encodeBuffer(buffers, new Uint8Array(data));
        break;
    }
  }

  private static encodeBuffer(buffers: Uint8Array[], data: Uint8Array): void {
    buffers.push(text2arr(data.length + ':'), data);
  }

  private static encodeString(buffers: Uint8Array[], data: string): void {
    buffers.push(text2arr(text2arr(data).byteLength + ':' + data));
  }

  private static encodeNumber(buffers: Uint8Array[], data: number): void {
    if (Number.isInteger(data)) {
      buffers.push(text2arr('i' + BigInt(data) + 'e'));
      return;
    }

    const maxLo = 0x80000000;
    const hi = (data / maxLo) << 0;
    const lo = data % maxLo << 0;
    const val = hi * maxLo + lo;

    buffers.push(text2arr('i' + val + 'e'));

    if (val !== data && !this._floatConversionDetected) {
      this._floatConversionDetected = true;
      console.warn(
        'WARNING: Possible data corruption detected with value "' + data + '":',
        'Bencoding only defines support for integers, value was converted to "' +
          val +
          '"'
      );
      console.trace();
    }
  }

  private static encodeDict(
    buffers: Uint8Array[],
    data: Record<string, unknown>
  ): void {
    buffers.push(this.buffD);

    const keys = Object.keys(data).sort();

    for (const key of keys) {
      if (data[key] === null) continue;
      this.encodeString(buffers, key);
      this._encode(buffers, data[key]);
    }

    buffers.push(this.buffE);
  }

  private static encodeDictMap(
    buffers: Uint8Array[],
    data: Map<unknown, unknown>
  ): void {
    buffers.push(this.buffD);

    const keys = Array.from(data.keys()).sort();

    for (const key of keys) {
      if (data.get(key) === null) continue;
      ArrayBuffer.isView(key)
        ? this._encode(buffers, key)
        : this.encodeString(buffers, String(key));
      this._encode(buffers, data.get(key));
    }

    buffers.push(this.buffE);
  }

  private static encodeList(buffers: Uint8Array[], data: unknown[]): void {
    buffers.push(this.buffL);

    for (const item of data) {
      if (item === null) continue;
      this._encode(buffers, item);
    }

    buffers.push(this.buffE);
  }

  private static encodeListSet(
    buffers: Uint8Array[],
    data: Set<unknown>
  ): void {
    buffers.push(this.buffL);

    for (const item of data) {
      if (item === null) continue;
      this._encode(buffers, item);
    }

    buffers.push(this.buffE);
  }
}

export default BencodeEncoder;
