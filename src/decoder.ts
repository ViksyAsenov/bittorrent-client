import {arr2hex, arr2text, text2arr} from './utils/uint8';

const INTEGER_START = 0x69; // 'i'
const STRING_DELIM = 0x3a; // ':'
const DICTIONARY_START = 0x64; // 'd'
const LIST_START = 0x6c; // 'l'
const END_OF_TYPE = 0x65; // 'e'

// Bencode encoder and decoder
// For more information on this format
// https://en.wikipedia.org/wiki/Bencode

class BencodeDecoder {
  private position: number;
  private data: Uint8Array;
  private encoding: string | null;
  private bytes: number;

  constructor() {
    this.position = 0;
    this.data = new Uint8Array();
    this.encoding = null;
    this.bytes = 0;
  }

  private static getIntFromBuffer(
    buffer: Uint8Array,
    start: number,
    end: number
  ): number {
    let sum = 0;
    let sign = 1;

    for (let i = start; i < end; i++) {
      const num = buffer[i];

      if (num < 58 && num >= 48) {
        sum = sum * 10 + (num - 48);
        continue;
      }

      if (i === start && num === 43) {
        // +
        continue;
      }

      if (i === start && num === 45) {
        // -
        sign = -1;
        continue;
      }

      if (num === 46) {
        // .
        break; // it's a float
      }

      throw new Error('Not a number: buffer[' + i + '] = ' + num);
    }

    return sum * sign;
  }

  public decode(
    data: Uint8Array | string,
    start?: number,
    end?: number,
    encoding?: string
  ): unknown {
    if (data === null || (data instanceof Uint8Array && data.length === 0)) {
      return null;
    }

    if (typeof start !== 'number' && encoding === null) {
      encoding = start as unknown as string;
      start = undefined;
    }

    if (typeof end !== 'number' && encoding === null) {
      encoding = end as unknown as string;
      end = undefined;
    }

    this.position = 0;
    this.encoding = encoding || null;

    this.data = !(data instanceof Uint8Array)
      ? text2arr(data)
      : new Uint8Array(data.slice(start, end));

    this.bytes = this.data.length;

    return this.next();
  }

  private next(): unknown {
    switch (this.data[this.position]) {
      case DICTIONARY_START:
        return this.decodeDictionary();
      case LIST_START:
        return this.decodeList();
      case INTEGER_START:
        return this.decodeInteger();
      default:
        return this.decodeBuffer();
    }
  }

  private find(chr: number): number {
    let i = this.position;
    const c = this.data.length;
    const d = this.data;

    while (i < c) {
      if (d[i] === chr) return i;
      i++;
    }

    throw new Error(
      'Invalid data: Missing delimiter "' +
        String.fromCharCode(chr) +
        '" [0x' +
        chr.toString(16) +
        ']'
    );
  }

  private decodeDictionary(): {[key: string]: unknown} {
    this.position++;

    const dict: {[key: string]: unknown} = {};

    while (this.data[this.position] !== END_OF_TYPE) {
      const buffer = this.decodeBuffer();
      let key = arr2text(buffer as Uint8Array);
      if (key.includes('\uFFFD')) key = arr2hex(buffer as Uint8Array);
      dict[key] = this.next();
    }

    this.position++;

    return dict;
  }

  private decodeList(): unknown[] {
    this.position++;

    const lst: unknown[] = [];

    while (this.data[this.position] !== END_OF_TYPE) {
      lst.push(this.next());
    }

    this.position++;

    return lst;
  }

  private decodeInteger(): number {
    const end = this.find(END_OF_TYPE);
    const number = BencodeDecoder.getIntFromBuffer(
      this.data,
      this.position + 1,
      end
    );

    this.position += end + 1 - this.position;

    return number;
  }

  private decodeBuffer(): string | Uint8Array {
    let sep = this.find(STRING_DELIM);
    const length = BencodeDecoder.getIntFromBuffer(
      this.data,
      this.position,
      sep
    );
    const end = ++sep + length;

    this.position = end;

    return this.encoding
      ? arr2text(this.data.slice(sep, end))
      : this.data.slice(sep, end);
  }
}

export default BencodeDecoder;